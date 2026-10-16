import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Recorder} from '../js/recorder.js';
import {PCMChunker} from '../js/pcm-chunker.js';

test('stop waits for serial encoding and persistence in capture order', async () => {
    let release; const saved = new Promise(resolve => {release = resolve;}); const received = [], calls = [];
    const recorder = new Recorder(async chunk => {received.push(chunk.index); await saved;}, {encode: async pcm => {calls.push(pcm[0]); return new Blob(['audio']);}});
    recorder.schedule({pcmData: new Float32Array([1]), sampleRate: 16000, index: 0});
    recorder.schedule({pcmData: new Float32Array([2]), sampleRate: 16000, index: 1});
    let stopped = false; const work = recorder.stop().then(() => {stopped = true;});
    await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false); assert.deepEqual(calls, [1]);
    release(); await work; assert.deepEqual(received, [0, 1]); assert.deepEqual(calls, [1, 2]);
});
test('discard suppresses a late encoder response and encoding failure preserves WAV', async () => {
    let release; const gate = new Promise(resolve => {release = resolve;}); let count = 0;
    const recorder = new Recorder(() => {count++;}, {encode: () => gate});
    recorder.schedule({pcmData: new Float32Array(10), sampleRate: 16000, index: 0});
    await Promise.resolve(); const discard = recorder.discard(); release(new Blob(['late'])); await discard; assert.equal(count, 0);
    const chunks = []; const fallback = new Recorder(chunk => chunks.push(chunk), {encode: async () => {throw new Error('encoder failed');}});
    fallback.schedule({pcmData: new Float32Array(10), sampleRate: 16000, index: 0}); await fallback.stop();
    assert.equal(chunks[0].blob.type, 'audio/wav'); assert.equal(chunks[0].blob.size, 64); assert(fallback.interrupted);
});
test('normal final flush does not report encoding backlog while a prior chunk is pending', async () => {
    let release; const gate = new Promise(resolve => {release = resolve;}); const interruptions = [], chunks = [];
    const recorder = new Recorder(chunk => chunks.push(chunk), {encode: async () => {await gate; return new Blob(['audio']);}, onInterruption: gap => interruptions.push(gap)});
    recorder.isRecording = true;
    recorder.chunker = new PCMChunker(chunk => recorder.schedule(chunk), {sampleRate: 1000, targetMs: 100, maxExtraMs: 0, overlapMs: 20});
    recorder.chunker.push(new Float32Array(110).fill(.5));
    const stop = recorder.stop(); await Promise.resolve(); release(); await stop;
    assert.equal(chunks.length, 2); assert.deepEqual(interruptions, []);
});
