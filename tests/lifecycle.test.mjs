// enable() / disable() against a fake `global`, GLib main loop and settings:
// checks that the extension reacts to the shell's signals and that disable()
// leaves no signal handler, GLib source, shader effect or Overview patch behind.
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import GLib from 'gi://GLib';
import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js';
import { WorkspaceThumbnail } from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

import AutoPiPManager from '../extension.js';

const EFFECT = 'nextpinp-rounded-corners';
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
// 400x225 window, offset 20.
const BOTTOM_RIGHT = { x: 1500, y: 835 };
const TOP_LEFT = { x: 20, y: 20 };
const TOP_RIGHT = { x: 1500, y: 20 };

class Emitter {
    constructor() {
        this._handlers = new Map();
        this._nextId = 1;
    }

    connect(name, callback) {
        const id = this._nextId++;
        this._handlers.set(id, { name, callback });
        return id;
    }

    disconnect(id) {
        assert.ok(this._handlers.delete(id), `disconnect of unknown handler ${id}`);
    }

    emit(name, ...args) {
        for (const handler of [...this._handlers.values()]) {
            if (handler.name === name)
                handler.callback(this, ...args);
        }
    }

    get handlerCount() {
        return this._handlers.size;
    }
}

class FakeActor extends Emitter {
    constructor(window) {
        super();
        this.window = window;
        this.effects = new Map();
    }

    get_meta_window() {
        return this.window;
    }

    get_effect(name) {
        return this.effects.get(name) ?? null;
    }

    add_effect_with_name(name, effect) {
        this.effects.set(name, effect);
    }

    remove_effect(effect) {
        for (const [name, value] of this.effects) {
            if (value === effect)
                this.effects.delete(name);
        }
    }
}

class FakeWindow extends Emitter {
    constructor({ title = 'Picture-in-Picture', x = 300, y = 300, width = 400, height = 225 } = {}) {
        super();
        this.title = title;
        this.frame = { x, y, width, height };
        this.actor = new FakeActor(this);
        this.minimized = false;
        this.fullscreen = false;
        this.stuck = false;
        this.above = false;
        this.focused = 0;
    }

    get_window_type() {
        return 0;
    }

    get_title() {
        return this.title;
    }

    get_wm_class() {
        return 'firefox';
    }

    get_wm_class_instance() {
        return 'firefox';
    }

    get_compositor_private() {
        return this.actor;
    }

    get_frame_rect() {
        return { ...this.frame };
    }

    get_work_area_current_monitor() {
        return WORK_AREA;
    }

    move_frame(_userOp, x, y) {
        Object.assign(this.frame, { x, y });
    }

    stick() {
        this.stuck = true;
    }

    make_above() {
        this.above = true;
    }

    focus() {
        this.focused++;
    }

    get position() {
        return { x: this.frame.x, y: this.frame.y };
    }
}

class FakeSettings extends Emitter {
    constructor() {
        super();
        this.values = {
            'corner': 'bottom-right',
            'offset': 20,
            'always-on-top': true,
            'always-on-all-workspaces': true,
            'corner-radius': 20,
            'never-in-focus': false,
            'do-not-show-on-overview': true,
        };
    }

    get_boolean(key) {
        return this.values[key];
    }

    get_int(key) {
        return this.values[key];
    }

    get_string(key) {
        return this.values[key];
    }

    set(key, value) {
        this.values[key] = value;
        this.emit(`changed::${key}`);
    }

    set_string(key, value) {
        this.set(key, value);
    }
}

// Shared per test; rebuilt in beforeEach.
let sources, settings, display, windows, extension;

// Runs every pending idle / timeout once, like one main loop iteration.
function runSources() {
    for (const [id, callback] of [...sources]) {
        if (sources.has(id) && !callback())
            sources.delete(id);
    }
}

function addWindow(options) {
    const window = new FakeWindow(options);
    windows.push(window);
    return window;
}

// A window that appears while the extension is enabled.
function createWindow(options) {
    const window = addWindow(options);
    display.emit('window-created', window);
    runSources();
    return window;
}

function drag(window, x, y) {
    display.emit('grab-op-begin', window);
    window.move_frame(true, x, y);
    display.emit('grab-op-end', window);
}

beforeEach(() => {
    sources = new Map();
    let nextSourceId = 1;
    const addSource = callback => {
        sources.set(nextSourceId, callback);
        return nextSourceId++;
    };
    Object.assign(GLib, {
        PRIORITY_DEFAULT: 0,
        PRIORITY_DEFAULT_IDLE: 200,
        SOURCE_REMOVE: false,
        SOURCE_CONTINUE: true,
        idle_add: (_priority, callback) => addSource(callback),
        timeout_add: (_priority, _interval, callback) => addSource(callback),
        source_remove: id => assert.ok(sources.delete(id), `removal of unknown source ${id}`),
    });

    Workspace.prototype._isOverviewWindow = () => true;
    WorkspaceThumbnail.prototype._isOverviewWindow = () => true;

    windows = [];
    settings = new FakeSettings();
    display = Object.assign(new Emitter(), {
        focus_window: null,
        unfocused: 0,
        get_tab_list: () => windows,
        get_current_time_roundtrip: () => 0,
        unset_input_focus() {
            this.unfocused++;
        },
    });
    globalThis.global = {
        display,
        get_window_actors: () => windows.map(w => w.actor),
        get_pointer: () => [0, 0, 0],
        workspace_manager: { get_active_workspace: () => null },
    };

    extension = new AutoPiPManager();
    extension.getSettings = () => settings;
});

function assertCleanedUp() {
    assert.equal(display.handlerCount, 0, 'display handlers left');
    assert.equal(settings.handlerCount, 0, 'settings handlers left');
    assert.equal(sources.size, 0, 'GLib sources left');
    for (const window of windows) {
        assert.equal(window.handlerCount, 0, 'window handlers left');
        assert.equal(window.actor.handlerCount, 0, 'actor handlers left');
        assert.equal(window.actor.get_effect(EFFECT), null, 'shader effect left');
    }
}

describe('enable / disable', () => {
    it('leaves nothing behind without windows', () => {
        const workspaceFilter = Workspace.prototype._isOverviewWindow;
        const thumbnailFilter = WorkspaceThumbnail.prototype._isOverviewWindow;

        extension.enable();
        assert.ok(display.handlerCount > 0);
        assert.notEqual(Workspace.prototype._isOverviewWindow, workspaceFilter);

        extension.disable();
        assertCleanedUp();
        assert.equal(Workspace.prototype._isOverviewWindow, workspaceFilter);
        assert.equal(WorkspaceThumbnail.prototype._isOverviewWindow, thumbnailFilter);
    });

    it('can be enabled again after disable', () => {
        extension.enable();
        extension.disable();
        extension.enable();
        const pip = createWindow();
        assert.deepEqual(pip.position, BOTTOM_RIGHT);
        extension.disable();
        assertCleanedUp();
    });

    it('picks up PiP windows that are already open and releases them', () => {
        const pip = addWindow();
        const other = addWindow({ title: 'Editor' });

        extension.enable();
        assert.ok(pip.actor.get_effect(EFFECT));
        assert.ok(pip.handlerCount > 0);
        assert.equal(other.actor.get_effect(EFFECT), null);
        assert.equal(other.handlerCount, 0);

        extension.disable();
        assertCleanedUp();
    });

    it('removes the effect even if the window title changed meanwhile', () => {
        const pip = addWindow();
        extension.enable();
        pip.title = 'Something else';
        extension.disable();
        assertCleanedUp();
    });

    it('cancels the idle of a window created right before disable', () => {
        extension.enable();
        const pip = addWindow();
        display.emit('window-created', pip);
        assert.equal(sources.size, 1);

        extension.disable();
        assertCleanedUp();
        assert.equal(pip.stuck, false);
    });

    it('drops the first-frame handler of a window that was never drawn', () => {
        extension.enable();
        const pip = createWindow({ width: 0, height: 0 });
        assert.equal(pip.actor.handlerCount, 1);

        extension.disable();
        assertCleanedUp();
        // A late first frame must not reach the disabled extension.
        pip.actor.emit('first-frame');
    });

    it('cancels a pending focus restore', () => {
        settings.values['never-in-focus'] = true;
        extension.enable();
        const pip = createWindow();
        display.focus_window = pip;
        display.emit('notify::focus-window');
        assert.equal(sources.size, 1);

        extension.disable();
        assertCleanedUp();
    });

    it('stops tracking a window when it is closed', () => {
        extension.enable();
        const pip = createWindow();
        pip.emit('size-changed');
        assert.equal(sources.size, 1);

        pip.emit('unmanaged');
        assert.equal(pip.handlerCount, 0);
        assert.equal(sources.size, 0);

        extension.disable();
    });
});

describe('new windows', () => {
    it('places a PiP window in the configured corner with its attributes', () => {
        extension.enable();
        const pip = createWindow();

        assert.deepEqual(pip.position, BOTTOM_RIGHT);
        assert.equal(pip.stuck, true);
        assert.equal(pip.above, true);
        assert.ok(pip.actor.get_effect(EFFECT));
        extension.disable();
    });

    it('waits for the first frame when the window has no size yet', () => {
        extension.enable();
        const pip = createWindow({ width: 0, height: 0 });
        assert.deepEqual(pip.position, { x: 300, y: 300 });

        Object.assign(pip.frame, { width: 400, height: 225 });
        pip.actor.emit('first-frame');
        assert.deepEqual(pip.position, BOTTOM_RIGHT);
        assert.equal(pip.actor.handlerCount, 0);
        extension.disable();
    });

    it('leaves ordinary windows alone', () => {
        extension.enable();
        const editor = createWindow({ title: 'Editor' });

        assert.deepEqual(editor.position, { x: 300, y: 300 });
        assert.equal(editor.stuck, false);
        assert.equal(editor.handlerCount, 0);
        extension.disable();
    });

    it('ignores a window whose title mentions PiP only later', () => {
        extension.enable();
        const browser = createWindow({ title: 'New Tab' });
        browser.title = 'Picture-in-Picture';

        drag(browser, 100, 100);
        assert.deepEqual(browser.position, { x: 100, y: 100 });
        assert.equal(settings.values.corner, 'bottom-right');
        assert.equal(Workspace.prototype._isOverviewWindow(browser), true);
        extension.disable();
    });
});

describe('placement', () => {
    it('snaps a dragged window to the nearest corner and remembers it', () => {
        extension.enable();
        const dragged = createWindow();
        const other = createWindow();

        drag(dragged, 100, 100);
        assert.deepEqual(dragged.position, TOP_LEFT);
        assert.equal(settings.values.corner, 'top-left');
        // The drag concerns that window only.
        assert.deepEqual(other.position, BOTTOM_RIGHT);
        extension.disable();
    });

    it('moves every PiP window when the corner is chosen in the preferences', () => {
        extension.enable();
        const first = createWindow();
        const second = createWindow();
        drag(first, 100, 100);

        settings.set('corner', 'top-right');
        assert.deepEqual(first.position, TOP_RIGHT);
        assert.deepEqual(second.position, TOP_RIGHT);
        extension.disable();
    });

    it('applies a new offset in the corner each window is in', () => {
        extension.enable();
        const first = createWindow();
        const second = createWindow();
        drag(first, 100, 100);

        settings.set('offset', 0);
        assert.deepEqual(first.position, { x: 0, y: 0 });
        assert.deepEqual(second.position, { x: 1520, y: 855 });
        extension.disable();
    });

    it('keeps the window in its own corner when the app resizes it', () => {
        extension.enable();
        const pip = createWindow();
        drag(pip, 100, 100);

        Object.assign(pip.frame, { width: 300, height: 300 });
        pip.emit('size-changed');
        runSources();
        assert.deepEqual(pip.position, TOP_LEFT);
        extension.disable();
    });

    it('does not move a fullscreen window', () => {
        extension.enable();
        const pip = createWindow();
        pip.fullscreen = true;
        Object.assign(pip.frame, { x: 0, y: 0, width: 1920, height: 1080 });

        pip.emit('size-changed');
        runSources();
        assert.deepEqual(pip.position, { x: 0, y: 0 });
        extension.disable();
    });

    it('re-places windows when the work area changes', () => {
        extension.enable();
        const pip = createWindow();
        pip.move_frame(false, 1400, 700);

        display.emit('workareas-changed');
        display.emit('workareas-changed');
        assert.equal(sources.size, 1);
        runSources();
        assert.deepEqual(pip.position, BOTTOM_RIGHT);
        extension.disable();
    });
});

describe('rounded corners', () => {
    it('follows the corner-radius setting', () => {
        extension.enable();
        const pip = createWindow();

        settings.set('corner-radius', 0);
        assert.equal(pip.actor.get_effect(EFFECT), null);
        settings.set('corner-radius', 12);
        assert.ok(pip.actor.get_effect(EFFECT));
        extension.disable();
    });
});

describe('never in focus', () => {
    it('gives focus back to the previously focused window', () => {
        settings.values['never-in-focus'] = true;
        extension.enable();
        const editor = createWindow({ title: 'Editor' });
        display.focus_window = editor;
        display.emit('notify::focus-window');

        const pip = createWindow();
        display.focus_window = pip;
        display.emit('notify::focus-window');
        runSources();

        assert.equal(editor.focused, 1);
        extension.disable();
    });

    it('drops focus when there is no other window', () => {
        settings.values['never-in-focus'] = true;
        extension.enable();
        const pip = createWindow();
        display.focus_window = pip;
        display.emit('notify::focus-window');
        runSources();

        assert.equal(display.unfocused, 1);
        extension.disable();
    });

    it('does nothing when the setting is off', () => {
        extension.enable();
        const pip = createWindow();
        display.focus_window = pip;
        display.emit('notify::focus-window');

        assert.equal(sources.size, 0);
        extension.disable();
    });
});

describe('Overview', () => {
    it('hides PiP windows from previews and thumbnails', () => {
        extension.enable();
        const pip = createWindow();
        const editor = createWindow({ title: 'Editor' });

        assert.equal(Workspace.prototype._isOverviewWindow(pip), false);
        assert.equal(WorkspaceThumbnail.prototype._isOverviewWindow(pip.actor), false);
        assert.equal(Workspace.prototype._isOverviewWindow(editor), true);
        assert.equal(WorkspaceThumbnail.prototype._isOverviewWindow(editor.actor), true);

        settings.set('do-not-show-on-overview', false);
        assert.equal(Workspace.prototype._isOverviewWindow(pip), true);
        extension.disable();
    });

    it('keeps a wrapper another extension installed on top of ours', () => {
        extension.enable();
        const pip = createWindow();

        const ours = Workspace.prototype._isOverviewWindow;
        const theirs = function (window) {
            return ours.call(this, window);
        };
        Workspace.prototype._isOverviewWindow = theirs;

        extension.disable();
        assert.equal(Workspace.prototype._isOverviewWindow, theirs);
        // Our wrapper is still in the chain but no longer hides anything.
        assert.equal(Workspace.prototype._isOverviewWindow(pip), true);
    });
});
