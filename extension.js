import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const PIP_TITLES = [
    'picture-in-picture',
    'picture in picture',
    'pictureinpicture',
    'pinp',
];

function isPiP(window) {
    if (window.get_window_type() !== Meta.WindowType.NORMAL)
        return false;

    const title = window.get_title() ?? '';
    if (PIP_TITLES.some(t => title.toLowerCase() === t))
        return true;

    const wmClass = window.get_wm_class() ?? '';
    const wmClassInstance = window.get_wm_class_instance() ?? '';
    if (/picture.?in.?picture/i.test(title) ||
        /picture.?in.?picture/i.test(wmClass) ||
        /picture.?in.?picture/i.test(wmClassInstance))
        return true;

    return false;
}

function applyPiPAttributes(window) {
    window.stick();
    window.make_above();
}

function moveToPiPCorner(window, settings) {
    const corner = settings.get_string('corner');
    const offset = settings.get_int('offset');

    const workArea = window.get_work_area_current_monitor();
    const frameRect = window.get_frame_rect();

    // If the window size is not yet known, bail — caller should retry via first-frame.
    if (!frameRect.width || !frameRect.height)
        return false;

    let x, y;
    switch (corner) {
        case 'top-left':
            x = workArea.x + offset;
            y = workArea.y + offset;
            break;
        case 'top-right':
            x = workArea.x + workArea.width - frameRect.width - offset;
            y = workArea.y + offset;
            break;
        case 'bottom-left':
            x = workArea.x + offset;
            y = workArea.y + workArea.height - frameRect.height - offset;
            break;
        case 'bottom-right':
        default:
            x = workArea.x + workArea.width - frameRect.width - offset;
            y = workArea.y + workArea.height - frameRect.height - offset;
            break;
    }

    window.move_frame(true, x, y);
    return true;
}

export default class AutoPiPManager extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._pendingIdles = new Set();

        this._windowCreatedId = global.display.connect('window-created', (_display, window) => {
            const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._pendingIdles.delete(id);

                if (!isPiP(window))
                    return GLib.SOURCE_REMOVE;

                applyPiPAttributes(window);

                // Try to move immediately; if size is not ready yet, wait for first-frame.
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

        for (const window of global.display.list_all_windows()) {
            if (isPiP(window)) {
                applyPiPAttributes(window);
                moveToPiPCorner(window, this._settings);
            }
        }
    }

    disable() {
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }

        for (const id of this._pendingIdles)
            GLib.source_remove(id);
        this._pendingIdles = null;

        this._settings = null;
    }
}
