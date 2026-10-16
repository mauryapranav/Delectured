import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleTranscript} from '../js/transcript.js';
const chunk = (index, startMs, text, segments = [], overlapMs = 0) => ({index, startMs, durationMs: 10000, status: 'transcribed', text, segments, overlapMs});
test('timed overlap is removed, absolute timestamps are retained, later repetition survives', () => {
    const a = chunk(0, 0, 'Introduction. Important definition.', [{start: 0, end: 8, text: 'Introduction.'}, {start: 8, end: 10, text: 'Important definition.'}]);
    const b = chunk(1, 8000, 'Important definition. More detail. Important definition.', [{start: 0, end: 2, text: 'Important definition.'}, {start: 2, end: 5, text: 'More detail.'}, {start: 5, end: 8, text: 'Important definition.'}], 2000);
    const result = assembleTranscript([b, a]);
    assert.equal(result.text, 'Introduction. Important definition.\n\nMore detail. Important definition.');
    assert.equal(result.segments[2].start, 10); assert.equal(result.segments.length, 4);
});
test('untimed overlap and quiet-boundary repetition are preserved with warnings', () => {
    const a = chunk(0, 0, 'x = x + 1;'); const b = chunk(1, 8000, 'x = x + 1;', [], 2000);
    assert.equal(assembleTranscript([a, b]).text, 'x = x + 1;\n\nx = x + 1;');
    assert(assembleTranscript([a, b]).warnings.length);
    assert.equal(assembleTranscript([a, {...b, overlapMs: 0}]).text, 'x = x + 1;\n\nx = x + 1;');
});
test('empty input and missing chunks remain explicit, code and Unicode stay intact', () => {
    assert.equal(assembleTranscript([]).text, '');
    const result = assembleTranscript([chunk(0, 0, 'if (x) {\n  y++;\n}'), chunk(2, 20000, 'हिंदी और English')]);
    assert(result.text.includes('  y++;')); assert(result.gaps.length); assert(result.text.endsWith('हिंदी और English'));
});
test('deduplicating an overlapping code line preserves following newline and indentation', () => {
    const a = chunk(0, 0, 'if x:', [{start: 8, end: 10, text: 'if x:'}]);
    const b = chunk(1, 8000, 'if x:\n    run()\n    done()', [{start: 0, end: 2, text: 'if x:'}, {start: 2, end: 4, text: 'run()'}], 2000);
    const result = assembleTranscript([a, b]);
    assert(result.text.includes('\n    run()\n    done()')); assert.equal(result.text.match(/if x:/g).length, 1);
});
