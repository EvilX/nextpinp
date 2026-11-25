import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { CORNER_VALUES } from '../prefs.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const metadata = JSON.parse(read('metadata.json'));

describe('metadata.json', () => {
    it('has the required fields', () => {
        for (const key of ['uuid', 'name', 'description', 'shell-version', 'url', 'settings-schema'])
            assert.ok(metadata[key], `missing ${key}`);
        assert.ok(Number.isInteger(metadata.version), 'version must be an integer');
    });

    it('references an existing settings schema', () => {
        const schemaFile = `${metadata['settings-schema']}.gschema.xml`;
        assert.ok(readdirSync(new URL('schemas/', root)).includes(schemaFile));
        assert.match(read(`schemas/${schemaFile}`), new RegExp(`id="${metadata['settings-schema']}"`));
    });
});

describe('settings schema', () => {
    const schema = read(`schemas/${metadata['settings-schema']}.gschema.xml`);

    it('default corner is one the preferences UI offers', () => {
        const [, corner] = schema.match(/<key name="corner"[^>]*>\s*<default>'([^']+)'<\/default>/);
        assert.ok(CORNER_VALUES.includes(corner), corner);
    });

    for (const key of ['corner', 'offset', 'always-on-top', 'always-on-all-workspaces', 'corner-radius',
        'never-in-focus', 'do-not-show-on-overview'])
        it(`declares key "${key}"`, () => assert.match(schema, new RegExp(`<key name="${key}"`)));
});

describe('translations', () => {
    it('POTFILES lists only existing files', () => {
        const files = read('po/POTFILES').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        for (const file of files)
            assert.doesNotThrow(() => read(file), file);
    });
});
