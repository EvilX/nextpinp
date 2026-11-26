import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js';
import { WorkspaceThumbnail } from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

const PIP_TITLES = [
    'picture-in-picture',
    'picture in picture',
    'pictureinpicture',
    'pinp',
];

export function isPiP(window) {
    if (!window)
        return false;
    if (window.get_window_type() !== Meta.WindowType.NORMAL)
        return false;

    const title = (window.get_title() ?? '').trim().toLowerCase();
    if (title && PIP_TITLES.some(t => title === t))
        return true;

    const wmClass = window.get_wm_class() ?? '';
    const wmClassInstance = window.get_wm_class_instance() ?? '';
    // Anchored to the end of the title: "Video - Picture in Picture" is a PiP
    // window, "How to use Picture-in-Picture — Firefox" is a browser window.
    if (title && /picture.?in.?picture$/i.test(title))
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

const BUTTONS_MASK = Clutter.ModifierType.BUTTON1_MASK |
    Clutter.ModifierType.BUTTON2_MASK | Clutter.ModifierType.BUTTON3_MASK;

const ROUNDED_EFFECT_NAME = 'nextpinp-rounded-corners';

const ROUNDED_DECLARATIONS = `
uniform sampler2D tex;
uniform vec4 fbo_box;
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
cogl_color_out *= rounded_alpha(fbo_box.xy + cogl_tex_coord_in[0].xy * fbo_box.zw);
`;

// Area of the actor (in actor-local coordinates) covered by the offscreen
// texture. Mirrors ClutterOffscreenEffect: the paint volume's bounding box,
// padded by _clutter_actor_box_enlarge_for_effects(). Returns [x, y, w, h].
//
// FRAGILE: the 0.75 / +3 padding copies private Clutter code (update_fbo() in
// clutter-offscreen-effect.c and _clutter_actor_box_enlarge_for_effects() in
// clutter-actor-box.c). If it changes there, the mask silently shifts by a
// pixel. Re-check both, and the corners by eye, whenever "shell-version" in
// metadata.json is bumped.
function offscreenBox(actor) {
    let x = 0, y = 0, width = actor.width, height = actor.height;

    const volume = actor.get_paint_volume();
    if (volume) {
        const origin = volume.get_origin();
        x = origin.x;
        y = origin.y;
        width = volume.get_width();
        height = volume.get_height();
    }

    const x2 = Math.ceil(x + width + 0.75);
    const y2 = Math.ceil(y + height + 0.75);
    const w = Math.round(width) + 3;
    const h = Math.round(height) + 3;
    return [x2 - w, y2 - h, w, h];
}

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
        // The actor can outlive its window (e.g. during the close animation).
        const window = actor?.get_meta_window();
        if (!window) {
            super.vfunc_paint_target(node, paintContext);
            return;
        }

        const buffer = window.get_buffer_rect();
        const frame = window.get_frame_rect();

        // Frame rect relative to the actor (actor covers the buffer rect).
        const x1 = frame.x - buffer.x;
        const y1 = frame.y - buffer.y;

        this.set_uniform_float('fbo_box', 4, offscreenBox(actor));
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

function buttonsPressed() {
    const [, , mods] = global.get_pointer();
    return (mods & BUTTONS_MASK) !== 0;
}

// PiP windows that are already open. Only used when the extension is enabled;
// afterwards a window counts as PiP if it is tracked, see _trackWindow().
function findPiPWindows() {
    return global.get_window_actors()
        .map(a => a.get_meta_window())
        .filter(w => isPiP(w));
}

// Window that should get keyboard focus instead of a PiP window: the one
// focused before it if still usable, otherwise the topmost usable window of
// the active workspace's tab list. Returns null when there is none.
export function focusFallback(previous, tabList, isPipWindow = isPiP) {
    const usable = w => w && !w.minimized && !isPipWindow(w);
    if (usable(previous) && tabList.includes(previous))
        return previous;
    return tabList.find(usable) ?? null;
}

// Returns the corner key and target {x, y} for the given corner + offset.
export function cornerPosition(corner, offset, workArea, frameRect) {
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

// Corner of the work area whose quadrant contains the window centre.
export function nearestCorner(workArea, frameRect) {
    const cx = frameRect.x + frameRect.width / 2;
    const cy = frameRect.y + frameRect.height / 2;
    const onLeft = cx < workArea.x + workArea.width / 2;
    const onTop  = cy < workArea.y + workArea.height / 2;

    if (onTop)
        return onLeft ? 'top-left' : 'top-right';
    return onLeft ? 'bottom-left' : 'bottom-right';
}

// Fullscreen and maximized windows fill the monitor and must stay put.
function isPlaceable(window) {
    return !window.fullscreen &&
        !window.maximized_horizontally && !window.maximized_vertically;
}

// Moves the window into the given corner of its monitor's work area.
// Returns false if it was left alone (not placeable or has no size yet).
function moveToCorner(window, corner, settings) {
    if (!isPlaceable(window))
        return false;

    const workArea = window.get_work_area_current_monitor();
    const frameRect = window.get_frame_rect();
    if (!frameRect.width || !frameRect.height)
        return false;

    const { x, y } = cornerPosition(corner, settings.get_int('offset'), workArea, frameRect);
    window.move_frame(true, x, y);
    return true;
}

// Moves the window into the corner it is closest to. Returns that corner, or
// null if the window was left alone.
function moveToNearestCorner(window, settings) {
    const corner = nearestCorner(
        window.get_work_area_current_monitor(), window.get_frame_rect());
    return moveToCorner(window, corner, settings) ? corner : null;
}

export default class AutoPiPManager extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._pendingIdles = new Set();
        // Window -> { signalIds, idleId, firstFrame }. A window is treated as
        // PiP if and only if it is in this map: isPiP() is evaluated once,
        // when the window appears, so an ordinary window whose title later
        // happens to mention picture-in-picture is never picked up.
        this._trackedWindows = new Map();
        this._grabbedWindow = null;
        this._lastFocusedWindow = null;
        this._focusRestoreId = 0;
        this._placeAllId = 0;
        this._persistingCorner = false;

        this._hideFromOverview();

        // Handle PiP windows that were already open before enabling.
        for (const window of findPiPWindows()) {
            applyRoundedCorners(window, this._settings);
            this._trackWindow(window);
        }

        this._settingsSignals = [
            this._settings.connect('changed::never-in-focus', () => this._queueFocusRestore()),
            this._settings.connect('changed::corner-radius', () => {
                for (const window of this._trackedWindows.keys())
                    applyRoundedCorners(window, this._settings);
            }),
            // Chosen in the preferences: move every PiP window there. Not when
            // the key is written by a drag, which concerns that window only.
            this._settings.connect('changed::corner', () => {
                if (!this._persistingCorner)
                    this._placeAll(this._settings.get_string('corner'));
            }),
            this._settings.connect('changed::offset', () => this._placeAll()),
        ];

        this._displaySignals = [
            global.display.connect('notify::focus-window', () => {
                const window = global.display.focus_window;
                if (this._isTracked(window))
                    this._queueFocusRestore();
                else if (window && !isPiP(window))
                    // A new PiP window gets focus before it is tracked.
                    this._lastFocusedWindow = window;
            }),

            global.display.connect('window-created', (_display, window) => {
                const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._pendingIdles.delete(id);

                    if (!isPiP(window))
                        return GLib.SOURCE_REMOVE;

                    applyPiPAttributes(window, this._settings);
                    applyRoundedCorners(window, this._settings);
                    this._trackWindow(window);
                    this._queueFocusRestore();

                    if (!moveToCorner(window, this._settings.get_string('corner'), this._settings))
                        this._placeOnFirstFrame(window);

                    return GLib.SOURCE_REMOVE;
                });
                this._pendingIdles.add(id);
            }),

            global.display.connect('grab-op-begin', (_display, window) => {
                if (this._isTracked(window))
                    this._grabbedWindow = window;
            }),

            // Snap to nearest corner when a PiP window move or resize ends.
            global.display.connect('grab-op-end', (_display, window) => {
                this._grabbedWindow = null;
                if (!this._isTracked(window))
                    return;
                this._snapToNearestCorner(window);
                this._queueFocusRestore();
            }),

            // Monitor layout, scale or panel changed: the corners moved.
            global.display.connect('workareas-changed', () => this._queuePlaceAll()),
        ];
    }

    _isTracked(window) {
        return !!window && this._trackedWindows.has(window);
    }

    // Snap to the nearest corner after a drag, then persist the new corner so
    // the next PiP window opens there.
    _snapToNearestCorner(window) {
        const corner = moveToNearestCorner(window, this._settings);
        if (!corner || corner === this._settings.get_string('corner'))
            return;

        this._persistingCorner = true;
        try {
            this._settings.set_string('corner', corner);
        } finally {
            this._persistingCorner = false;
        }
    }

    // Re-places every PiP window: into the given corner, or else into the
    // corner each one is closest to.
    _placeAll(corner = null) {
        for (const window of this._trackedWindows.keys()) {
            if (window === this._grabbedWindow)
                continue;
            if (corner)
                moveToCorner(window, corner, this._settings);
            else
                moveToNearestCorner(window, this._settings);
        }
    }

    _queuePlaceAll() {
        if (this._placeAllId)
            return;

        this._placeAllId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pendingIdles.delete(this._placeAllId);
            this._placeAllId = 0;
            this._placeAll();
            return GLib.SOURCE_REMOVE;
        });
        this._pendingIdles.add(this._placeAllId);
    }

    // A new window may have no size yet; place it once it has been drawn.
    _placeOnFirstFrame(window) {
        const actor = window.get_compositor_private();
        const record = this._trackedWindows.get(window);
        if (!actor || !record || record.firstFrame)
            return;

        const id = actor.connect('first-frame', () => {
            actor.disconnect(id);
            record.firstFrame = null;
            moveToCorner(window, this._settings.get_string('corner'), this._settings);
        });
        record.firstFrame = { actor, id };
    }

    // Overview previews and thumbnails ask _isOverviewWindow() which windows
    // to show; both are rebuilt every time the Overview opens, so a changed
    // setting applies the next time it is shown.
    _hideFromOverview() {
        const filter = {
            hidden: window => this._settings.get_boolean('do-not-show-on-overview') &&
                this._isTracked(window),
        };
        const patch = (proto, toWindow) => {
            const original = proto._isOverviewWindow;
            const wrapper = function (arg) {
                return original.call(this, arg) && !filter.hidden?.(toWindow(arg));
            };
            proto._isOverviewWindow = wrapper;
            return { proto, original, wrapper };
        };

        this._overviewFilter = filter;
        this._overviewPatches = [
            patch(Workspace.prototype, window => window),
            patch(WorkspaceThumbnail.prototype, actor => actor.get_meta_window()),
        ];
    }

    _restoreOverview() {
        if (!this._overviewPatches)
            return;

        // If another extension wrapped the method after us, putting the
        // original back would throw its wrapper away. Leave ours in the chain
        // then, switched off, so it only forwards to the original.
        for (const { proto, original, wrapper } of this._overviewPatches) {
            if (proto._isOverviewWindow === wrapper)
                proto._isOverviewWindow = original;
        }
        this._overviewFilter.hidden = null;
        this._overviewFilter = null;
        this._overviewPatches = null;
    }

    // Moves keyboard focus off a PiP window. Mutter focuses a window on button
    // press, before an interactive move starts, so wait until the buttons are
    // released and no PiP grab is active.
    _queueFocusRestore() {
        if (!this._settings.get_boolean('never-in-focus') || this._focusRestoreId)
            return;

        this._focusRestoreId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            if (this._grabbedWindow || buttonsPressed())
                return GLib.SOURCE_CONTINUE;

            this._focusRestoreId = 0;
            this._restoreFocus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _restoreFocus() {
        if (!this._settings.get_boolean('never-in-focus'))
            return;

        if (!this._isTracked(global.display.focus_window))
            return;

        const workspace = global.workspace_manager.get_active_workspace();
        const tabList = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
        const target = focusFallback(this._lastFocusedWindow, tabList,
            window => this._isTracked(window));
        const timestamp = global.display.get_current_time_roundtrip();

        if (target)
            target.focus(timestamp);
        else
            global.display.unset_input_focus(timestamp);
    }

    // Marks the window as PiP and keeps it glued to its corner when the app
    // resizes it (e.g. a video with another aspect ratio). Interactive
    // resizes are handled on grab-op-end instead.
    _trackWindow(window) {
        if (this._trackedWindows.has(window))
            return;

        const record = { signalIds: [], idleId: 0, firstFrame: null };

        record.signalIds.push(window.connect('size-changed', () => {
            if (this._grabbedWindow === window || record.idleId)
                return;
            record.idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._pendingIdles.delete(record.idleId);
                record.idleId = 0;
                moveToNearestCorner(window, this._settings);
                return GLib.SOURCE_REMOVE;
            });
            this._pendingIdles.add(record.idleId);
        }));
        record.signalIds.push(window.connect('unmanaged', () => this._untrackWindow(window)));

        this._trackedWindows.set(window, record);
    }

    _untrackWindow(window) {
        const record = this._trackedWindows.get(window);
        if (!record)
            return;

        for (const id of record.signalIds)
            window.disconnect(id);
        if (record.idleId) {
            GLib.source_remove(record.idleId);
            this._pendingIdles.delete(record.idleId);
        }
        if (record.firstFrame)
            record.firstFrame.actor.disconnect(record.firstFrame.id);

        this._trackedWindows.delete(window);
        if (this._grabbedWindow === window)
            this._grabbedWindow = null;
    }

    disable() {
        this._restoreOverview();

        for (const id of this._displaySignals)
            global.display.disconnect(id);
        this._displaySignals = null;

        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = null;

        if (this._focusRestoreId) {
            GLib.source_remove(this._focusRestoreId);
            this._focusRestoreId = 0;
        }
        this._lastFocusedWindow = null;

        for (const window of [...this._trackedWindows.keys()]) {
            removeRoundedCorners(window);
            this._untrackWindow(window);
        }
        this._trackedWindows = null;
        this._grabbedWindow = null;

        for (const id of this._pendingIdles)
            GLib.source_remove(id);
        this._pendingIdles = null;
        this._placeAllId = 0;

        this._settings = null;
    }
}
