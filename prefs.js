import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const CORNER_VALUES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

export default class AutoPiPPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const _ = this.gettext.bind(this);
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({ title: _('Window Position') });
        page.add(group);

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
        const currentCorner = settings.get_string('corner');
        cornerRow.selected = Math.max(0, CORNER_VALUES.indexOf(currentCorner));
        cornerRow.connect('notify::selected', () => {
            settings.set_string('corner', CORNER_VALUES[cornerRow.selected]);
        });
        group.add(cornerRow);

        const offsetRow = new Adw.SpinRow({
            title: _('Offset'),
            subtitle: _('Distance from the screen corner in pixels'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 50,
                step_increment: 1,
                value: settings.get_int('offset'),
            }),
        });
        offsetRow.connect('notify::value', () => {
            settings.set_int('offset', offsetRow.value);
        });
        group.add(offsetRow);

        window.add(page);
    }
}
