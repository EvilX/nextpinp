import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isPiP, cornerPosition, nearestCorner } from '../extension.js';

function fakeWindow({ title = '', wmClass = '', wmClassInstance = '', type = 0 } = {}) {
    return {
        get_window_type: () => type,
        get_title: () => title,
        get_wm_class: () => wmClass,
        get_wm_class_instance: () => wmClassInstance,
    };
}

describe('isPiP', () => {
    it('rejects missing windows', () => {
        assert.equal(isPiP(null), false);
        assert.equal(isPiP(undefined), false);
    });

    for (const title of ['Picture-in-Picture', 'Picture in picture', 'PictureInPicture', 'pinp'])
        it(`matches title "${title}"`, () => assert.equal(isPiP(fakeWindow({ title })), true));

    it('matches titles containing picture-in-picture', () => {
        assert.equal(isPiP(fakeWindow({ title: 'Video - Picture in Picture' })), true);
    });

    it('matches by WM class and instance', () => {
        assert.equal(isPiP(fakeWindow({ wmClass: 'PictureInPicture' })), true);
        assert.equal(isPiP(fakeWindow({ wmClassInstance: 'picture_in_picture' })), true);
    });

    it('ignores non-normal windows', () => {
        assert.equal(isPiP(fakeWindow({ title: 'Picture-in-Picture', type: 3 })), false);
    });

    it('ignores ordinary windows', () => {
        assert.equal(isPiP(fakeWindow({ title: 'Firefox', wmClass: 'firefox' })), false);
        assert.equal(isPiP(fakeWindow({ title: 'pinpoint' })), false);
        assert.equal(isPiP(fakeWindow({ title: null, wmClass: null, wmClassInstance: null })), false);
    });
});

const workArea = { x: 100, y: 50, width: 1920, height: 1000 };
const frame = { width: 400, height: 225 };

describe('cornerPosition', () => {
    const cases = {
        'top-left': { x: 120, y: 70 },
        'top-right': { x: 100 + 1920 - 400 - 20, y: 70 },
        'bottom-left': { x: 120, y: 50 + 1000 - 225 - 20 },
        'bottom-right': { x: 100 + 1920 - 400 - 20, y: 50 + 1000 - 225 - 20 },
    };

    for (const [corner, expected] of Object.entries(cases))
        it(corner, () => assert.deepEqual(cornerPosition(corner, 20, workArea, frame), expected));

    it('falls back to bottom-right for unknown values', () => {
        assert.deepEqual(cornerPosition('nonsense', 20, workArea, frame), cases['bottom-right']);
    });

    it('supports zero offset', () => {
        assert.deepEqual(cornerPosition('top-left', 0, workArea, frame), { x: 100, y: 50 });
    });
});

describe('nearestCorner', () => {
    const at = (x, y) => ({ x, y, width: 400, height: 200 });
    // Work area centre is (1060, 550); frame centre is (x + 200, y + 100).

    it('top-left', () => assert.equal(nearestCorner(workArea, at(150, 60)), 'top-left'));
    it('top-right', () => assert.equal(nearestCorner(workArea, at(1500, 60)), 'top-right'));
    it('bottom-left', () => assert.equal(nearestCorner(workArea, at(150, 800)), 'bottom-left'));
    it('bottom-right', () => assert.equal(nearestCorner(workArea, at(1500, 800)), 'bottom-right'));

    it('treats the exact centre as bottom-right', () => {
        assert.equal(nearestCorner(workArea, at(860, 450)), 'bottom-right');
    });
});
