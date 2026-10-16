import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Session} from '../js/session.js';
import {Queue} from '../js/queue.js';
import {createLectureStore} from '../js/store.js';
import {uploadLecture, validateUpload, UPLOAD_LIMITS} from '../js/upload.js';
const gate = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
async function fixture(transcribe = async () => ({text: 'text'})) {
    const store = createLectureStore(crypto.randomUUID()); const queue = new Queue({store, transcribe, online: () => true});
    let callback; const recorder = {durationMs: 20, isRecording: false, async start() {this.isRecording = true;},
        async stop() {this.isRecording = false;}, async discard() {this.isRecording = false;}};
    const session = new Session({store, queue, createRecorder: cb => {callback = cb; return recorder;}});
    return {store, queue, recorder, session, chunk: () => callback({index: 0, startMs: 0, durationMs: 20, overlapMs: 0, blob: new Blob(['audio'])})};
}
test('session stop waits for final callback and active transcription', async () => {
    const entered = gate(), result = gate(); const f = await fixture(async () => {entered.resolve(); await result.promise; return {text: 'final'};});
    await f.session.start({id: 'capture', language: 'hi'});
    f.recorder.stop = async () => {await f.chunk();};
    let done = false; const stop = f.session.stop().then(() => {done = true;}); await entered.promise;
    assert.equal(done, false); result.resolve(); await stop; assert.equal((await f.store.getLecture('capture')).transcript, 'final'); await f.store.close();
});
test('discard rejects late callbacks and removes saved lecture/audio', async () => {
    const f = await fixture(); await f.session.start({id: 'discard'}); await f.session.discard();
    await assert.rejects(f.chunk(), {name: 'AbortError'}); assert.equal(await f.store.getLecture('discard'), undefined); await f.store.close();
});
test('session prevents double start and records unknown reload gap', async () => {
    const f = await fixture(); await f.session.start({id: 'active'});
    assert.throws(() => f.session.start({id: 'second'}), /Finish/); await f.session.discard();
    await f.store.saveLecture({id: 'reloaded', status: 'recording'});
    await f.store.saveChunk('reloaded', 0, new Blob(['a'])); await f.session.recover('reloaded');
    assert.equal((await f.store.getLecture('reloaded')).captureGaps[0].reason, 'reload'); await f.store.close();
});
test('bounded upload emits independent indexed parts and rejects oversize before decoding', async () => {
    const file = new File(['fixture'], 'audio.mp3'); const chunks = [];
    const length = 301 * 16000;
    await uploadLecture(file, {probe: async () => 301, decode: async () => ({duration: 301, sampleRate: 16000, numberOfChannels: 1, length, getChannelData: () => new Float32Array(length)}),
        encode: async pcm => new Blob([new Uint8Array(pcm.length / 100)]), onChunk: c => chunks.push(c)});
    assert.deepEqual(chunks.map(c => [c.index, c.startMs, c.durationMs]), [[0, 0, 300000], [1, 300000, 1000]]);
    assert.throws(() => validateUpload(new File([new Uint8Array(UPLOAD_LIMITS.bytes + 1)], 'large.mp3')), /20 MiB/);
    await assert.rejects(uploadLecture(file, {probe: async () => 601}), /10 minutes/);
    const controller = new AbortController(); controller.abort(); await assert.rejects(uploadLecture(file, {signal: controller.signal}), {name: 'AbortError'});
});
test('recovery reserves the session before storage reads and releases it on initialization failure', async () => {
    const read = gate(); const store = {getLecture: () => read.promise, getAllChunks: async () => [], updateLecture: async () => {throw new Error('disk unavailable');}};
    const queue = {subscribe() {}, resume: async () => {throw new Error('Must not reach queue');}};
    const session = new Session({store, queue});
    const first = session.recover('one'); const rejection = assert.rejects(first, /disk unavailable/);
    await assert.rejects(session.recover('two'), /Finish/);
    read.resolve({status: 'interrupted', captureGaps: []}); await rejection;
    assert.equal(session.busy, false); assert.equal(session.active.state, 'failed');
    await assert.rejects(session.recover('one'), /disk unavailable/); assert.equal(session.busy, false);
});

test('recovery reconstructs known duration without inventing interruption time', async () => {
    const f = await fixture();
    await f.store.saveLecture({id: 'duration-recovery', status: 'recording'});
    await f.store.putChunk({lectureId: 'duration-recovery', index: 0, startMs: 0, durationMs: 300000, blob: new Blob(['audio'])});
    await f.session.recover('duration-recovery');
    const lecture = await f.store.getLecture('duration-recovery');
    assert.equal(lecture.durationMs, 300000);
    assert.equal(lecture.captureGaps[0].durationMs, null);
    assert.equal(lecture.captureGaps[0].atMs, 300000);
    await f.store.close();
});
