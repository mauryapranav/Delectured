import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PCMChunker, CAPTURE_DEFAULTS} from '../js/pcm-chunker.js';

test('capture assigns ordered indexes, hard overlap, and a short final tail', () => {
    const chunks = [];
    const chunker = new PCMChunker(c => chunks.push(c), {sampleRate: 1000, targetMs: 100, maxExtraMs: 20, quietMs: 10, overlapMs: 20});
    chunker.push(new Float32Array(255).fill(0.5)); chunker.flush();
    assert.deepEqual(chunks.map(c => c.index), [0, 1, 2]);
    assert.deepEqual(chunks.map(c => [c.startMs, c.durationMs, c.overlapMs]), [[0, 120, 0], [100, 120, 20], [200, 55, 20]]);
    assert.equal(chunker.totalSamples, 255);
});
test('quiet boundary avoids overlap and flushing only overlap adds no duplicate chunk', () => {
    const chunks = []; const c = new PCMChunker(v => chunks.push(v), {sampleRate: 1000, targetMs: 100, maxExtraMs: 20, quietMs: 10, overlapMs: 20});
    c.push(new Float32Array(90).fill(.5)); c.push(new Float32Array(10)); c.flush();
    assert.equal(chunks.length, 1); assert.equal(chunks[0].durationMs, 100);
    const hard = []; const d = new PCMChunker(v => hard.push(v), {sampleRate: 1000, targetMs: 100, maxExtraMs: 20, overlapMs: 20});
    d.push(new Float32Array(120).fill(.5)); d.flush(); assert.equal(hard.length, 1);
});
test('production boundaries cover more than ten minutes without missing samples', () => {
    assert.equal(CAPTURE_DEFAULTS.targetMs, 300000); assert.equal(CAPTURE_DEFAULTS.maxExtraMs, 15000);
    const chunks = []; const c = new PCMChunker(value => chunks.push(value));
    const second = new Float32Array(16000).fill(.5);
    for (let i = 0; i < 635; i++) c.push(second);
    c.flush();
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks.map(v => [v.startMs, v.durationMs, v.overlapMs]), [[0, 315000, 0], [313000, 315000, 2000], [626000, 9000, 2000]]);
    assert.equal(chunks.reduce((sum, c) => sum + c.durationMs - c.overlapMs, 0), 635000);
});
