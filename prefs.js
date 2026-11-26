import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export const CORNER_VALUES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

// Position of a stored corner value in CORNER_VALUES; unknown values map to
// the first entry so the combo row always has a valid selection.
export function cornerIndex(corner) {
    return Math.max(0, CORNER_VALUES.indexOf(corner));
}

export default class AutoPiPPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const _ = this.gettext.bind(this);
        const settings = this.getSettings();

        // Rows are bound to the settings in both directions, so a value
        // changed elsewhere shows up in an open preferences window.
        const switchRow = (key, title, subtitle) => {
            const row = new Adw.SwitchRow({ title, subtitle });
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };

        // Limits come from the <range> of the key in the schema.
        const spinRow = (key, title, subtitle) => {
            const [, [lower, upper]] = settings.settings_schema.get_key(key)
                .get_range().recursiveUnpack();
            const row = new Adw.SpinRow({
                title,
                subtitle,
                adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1 }),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };

        const page = new Adw.PreferencesPage();

        // — Behaviour group —
        const behaviourGroup = new Adw.PreferencesGroup({ title: _('Behaviour') });
        page.add(behaviourGroup);

        behaviourGroup.add(switchRow('always-on-top',
            _('Always on Top'),
            _('Keep PiP window above all other windows')));
        behaviourGroup.add(switchRow('always-on-all-workspaces',
            _('Always Visible on All Workspaces'),
            _('Show PiP window on every workspace')));
        behaviourGroup.add(switchRow('never-in-focus',
            _('Never in Focus'),
            _('Return keyboard focus to another window when PiP takes it')));
        behaviourGroup.add(switchRow('do-not-show-on-overview',
            _('Do Not Show on Overview'),
            _('Hide PiP window from workspace previews and thumbnails')));

        // — Window Position group —
        const positionGroup = new Adw.PreferencesGroup({ title: _('Window Position') });
        page.add(positionGroup);

        const cornerRow = new Adw.ComboRow({
            title: _('Corner'),
            model: new Gtk.StringList({
                strings: [
                    _('Top Left'),
                    _('Top Right'),
                    _('Bottom Right'),
                    _('Bottom Left'),
                ],
            }),
        });
        // The extension rewrites this key when a PiP window is dragged to
        // another corner, so follow it while the window is open.
        const syncCorner = () => {
            cornerRow.selected = cornerIndex(settings.get_string('corner'));
        };
        syncCorner();
        cornerRow.connect('notify::selected', () => {
            const corner = CORNER_VALUES[cornerRow.selected];
            if (corner !== settings.get_string('corner'))
                settings.set_string('corner', corner);
        });
        const cornerChangedId = settings.connect('changed::corner', syncCorner);
        window.connect('close-request', () => {
            settings.disconnect(cornerChangedId);
            return false;
        });
        positionGroup.add(cornerRow);

        positionGroup.add(spinRow('offset',
            _('Offset'),
            _('Distance from the screen corner in pixels')));

        // — Appearance group —
        const appearanceGroup = new Adw.PreferencesGroup({ title: _('Appearance') });
        page.add(appearanceGroup);

        appearanceGroup.add(spinRow('corner-radius',
            _('Corner Radius'),
            _('Rounding of the PiP window corners in pixels, 0 to disable')));

        window.add(page);
    }
}
