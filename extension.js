import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const PIP_TITLES = [
    'picture-in-picture',
    'picture in picture',
    'pictureinpicture',
    'pinp',
];

function isPiP(window) {
    if (!window)
        return false;
    if (window.get_window_type() !== Meta.WindowType.NORMAL)
        return false;

    const title = (window.get_title() ?? '').toLowerCase();
    if (title && PIP_TITLES.some(t => title === t))
        return true;

    const wmClass = window.get_wm_class() ?? '';
    const wmClassInstance = window.get_wm_class_instance() ?? '';
    if (title && /picture.?in.?picture/i.test(title))
        return true;
    if (wmClass && /picture.?in.?picture/i.test(wmClass))
        return true;
    if (wmClassInstance && /picture.?in.?picture/i.test(wmClassInstance))
        return true;

    return false;
}

function applyPiPAttributes(window, settings) {
    if (settings.get_boolean('always-on-all-workspaces'))
        window.stick();
    if (settings.get_boolean('always-on-top'))
        window.make_above();
}

const ROUNDED_EFFECT_NAME = 'nextpinp-rounded-corners';

const ROUNDED_DECLARATIONS = `
uniform sampler2D tex;
uniform vec2 actor_size;
uniform vec4 bounds;
uniform float radius;

float rounded_alpha(vec2 p) {
    vec2 center = (bounds.xy + bounds.zw) * 0.5;
    vec2 half_size = (bounds.zw - bounds.xy) * 0.5;
    float r = min(radius, min(half_size.x, half_size.y));
    vec2 q = abs(p - center) - half_size + r;
    float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
    return clamp(0.5 - d, 0.0, 1.0);
}
`;

const ROUNDED_CODE = `
cogl_color_out = cogl_color_in * texture2D(tex, cogl_tex_coord_in[0].xy);
cogl_color_out *= rounded_alpha(cogl_tex_coord_in[0].xy * actor_size);
`;

// Masks the window actor to a rounded rectangle matching the visible frame.
const RoundedCornersEffect = GObject.registerClass(
class RoundedCornersEffect extends Clutter.ShaderEffect {
    _init(radius) {
        super._init();
        this._radius = radius;
    }

    set radius(value) {
        this._radius = value;
        this.queue_repaint();
    }

    vfunc_get_static_snippet() {
        const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
            ROUNDED_DECLARATIONS, null);
        snippet.set_replace(ROUNDED_CODE);
        return snippet;
    }

    vfunc_paint_target(node, paintContext) {
        const actor = this.actor;
        const window = actor.get_meta_window();
        const buffer = window.get_buffer_rect();
        const frame = window.get_frame_rect();

        // Frame rect relative to the actor (actor covers the buffer rect).
        const x1 = frame.x - buffer.x;
        const y1 = frame.y - buffer.y;

        this.set_uniform_float('actor_size', 2, [actor.width, actor.height]);
        this.set_uniform_float('bounds', 4,
            [x1, y1, x1 + frame.width, y1 + frame.height]);
        this.set_uniform_float('radius', 1, [this._radius]);

        super.vfunc_paint_target(node, paintContext);
    }
});

function applyRoundedCorners(window, settings) {
    const actor = window.get_compositor_private();
    if (!actor)
        return;

    const radius = settings.get_int('corner-radius');
    const effect = actor.get_effect(ROUNDED_EFFECT_NAME);

    if (radius <= 0) {
        if (effect)
            actor.remove_effect(effect);
        return;
    }

    if (effect)
        effect.radius = radius;
    else
        actor.add_effect_with_name(ROUNDED_EFFECT_NAME, new RoundedCornersEffect(radius));
}

function removeRoundedCorners(window) {
    const actor = window.get_compositor_private();
    const effect = actor?.get_effect(ROUNDED_EFFECT_NAME);
    if (effect)
        actor.remove_effect(effect);
}

function pipWindows() {
    return global.get_window_actors()
        .map(a => a.get_meta_window())
        .filter(w => isPiP(w));
}

// Returns the corner key and target {x, y} for the given corner + offset.
function cornerPosition(corner, offset, workArea, frameRect) {
    switch (corner) {
        case 'top-left':
            return { x: workArea.x + offset, y: workArea.y + offset };
        case 'top-right':
            return {
                x: workArea.x + workArea.width - frameRect.width - offset,
                y: workArea.y + offset,
            };
        case 'bottom-left':
            return {
                x: workArea.x + offset,
                y: workArea.y + workArea.height - frameRect.height - offset,
            };
        case 'bottom-right':
        default:
            return {
                x: workArea.x + workArea.width - frameRect.width - offset,
                y: workArea.y + workArea.height - frameRect.height - offset,
            };
    }
}

function moveToPiPCorner(window, settings) {
    const workArea = window.get_work_area_current_monitor();
    const frameRect = window.get_frame_rect();

    if (!frameRect.width || !frameRect.height)
        return false;

    const { x, y } = cornerPosition(
        settings.get_string('corner'),
        settings.get_int('offset'),
        workArea, frameRect
    );
    window.move_frame(true, x, y);
    return true;
}

// Snap to the nearest corner after a drag, then persist the new corner in settings.
function snapToNearestCorner(window, settings) {
    const workArea = window.get_work_area_current_monitor();
    const frameRect = window.get_frame_rect();
    const offset = settings.get_int('offset');

    // Use window centre to decide which quadrant it's in.
    const cx = frameRect.x + frameRect.width / 2;
    const cy = frameRect.y + frameRect.height / 2;
    const onLeft = cx < workArea.x + workArea.width / 2;
    const onTop  = cy < workArea.y + workArea.height / 2;

    const corner =
        onLeft && onTop  ? 'top-left'    :
        !onLeft && onTop ? 'top-right'   :
        onLeft           ? 'bottom-left' : 'bottom-right';

    const { x, y } = cornerPosition(corner, offset, workArea, frameRect);
    window.move_frame(true, x, y);

    // Persist so the next PiP window opens in the same corner.
    settings.set_string('corner', corner);
}

export default class AutoPiPManager extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._pendingIdles = new Set();

        // Round PiP windows that were already open before enabling.
        for (const window of pipWindows())
            applyRoundedCorners(window, this._settings);

        this._radiusChangedId = this._settings.connect('changed::corner-radius', () => {
            for (const window of pipWindows())
                applyRoundedCorners(window, this._settings);
        });

        this._windowCreatedId = global.display.connect('window-created', (_display, window) => {
            const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._pendingIdles.delete(id);

                if (!isPiP(window))
                    return GLib.SOURCE_REMOVE;

                applyPiPAttributes(window, this._settings);
                applyRoundedCorners(window, this._settings);

                if (!moveToPiPCorner(window, this._settings)) {
                    const actor = window.get_compositor_private();
                    if (actor) {
                        const frameId = actor.connect('first-frame', () => {
                            actor.disconnect(frameId);
                            moveToPiPCorner(window, this._settings);
                        });
                    }
                }

                return GLib.SOURCE_REMOVE;
            });
            this._pendingIdles.add(id);
        });

        // Snap to nearest corner when a PiP window drag ends.
        this._grabOpEndId = global.display.connect('grab-op-end', (_display, window, op) => {
            if (!window)
                return;
            if (op !== Meta.GrabOp.MOVING && op !== Meta.GrabOp.KEYBOARD_MOVING)
                return;
            if (!isPiP(window))
                return;
            snapToNearestCorner(window, this._settings);
        });
    }

    disable() {
        if (this._radiusChangedId) {
            this._settings.disconnect(this._radiusChangedId);
            this._radiusChangedId = null;
        }

        for (const window of pipWindows())
            removeRoundedCorners(window);

        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }

        if (this._grabOpEndId) {
            global.display.disconnect(this._grabOpEndId);
            this._grabOpEndId = null;
        }

        for (const id of this._pendingIdles)
            GLib.source_remove(id);
        this._pendingIdles = null;

        this._settings = null;
    }
}
