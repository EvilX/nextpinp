// Minimal stand-ins for GJS / GNOME Shell modules so extension code can be
// imported under Node. Only what is touched at module load or by the
// functions under test is provided.
const STUBS = {
    'gi://Meta': 'export default { WindowType: { NORMAL: 0, DIALOG: 3, UTILITY: 6 }, TabList: { NORMAL: 0 } };',
    'gi://GObject': 'export default { registerClass: (...args) => args.at(-1) };',
    'gi://Clutter': 'export default { ShaderEffect: class {}, ModifierType: {} };',
    'resource:///org/gnome/shell/extensions/extension.js':
        'export class Extension {}',
    'resource:///org/gnome/shell/ui/workspace.js':
        'export class Workspace {}',
    'resource:///org/gnome/shell/ui/workspaceThumbnail.js':
        'export class WorkspaceThumbnail {}',
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js':
        'export class ExtensionPreferences {}',
};

export function resolve(specifier, context, next) {
    if (specifier.startsWith('gi://') || specifier.startsWith('resource://'))
        return { url: `stub:${specifier}`, shortCircuit: true };
    return next(specifier, context);
}

export function load(url, context, next) {
    if (url.startsWith('stub:')) {
        const source = STUBS[url.slice(5)] ?? 'export default {};';
        return { format: 'module', source, shortCircuit: true };
    }
    return next(url, context);
}
