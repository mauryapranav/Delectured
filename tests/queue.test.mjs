import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLectureStore} from '../js/store.js';
import {Queue} from '../js/queue.js';

const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
async function fixture(options = {}) {
    const store = createLectureStore(`queue-${crypto.randomUUID()}`);
    await store.saveLecture({id: 'lecture', language: 'hi-en'});
    const queue = new Queue({store, online: () => true, ...options});
    return {store, queue, seed: index => store.putChunk({lectureId: 'lecture', index, blob: new Blob([`audio-${index}`])})};
}
test('concurrent drains wait for one request and preserve ordered durable text', async () => {
    const entered = deferred(), release = deferred(); let calls = 0;
    const {store, queue, seed} = await fixture({transcribe: async () => {calls++; entered.resolve(); await release.promise; return {text: `text-${calls}`};}});
    await seed(1); await seed(0);
    const progress = []; queue.subscribe(event => progress.push(event));
    const first = queue.drain('lecture'); await entered.promise;
    let settled = false; const second = queue.drain('lecture').then(() => {settled = true;});
    await Promise.resolve(); assert.equal(settled, false);
    release.resolve(); await Promise.all([first, second]);
    assert.equal(calls, 2);
    assert.equal((await store.getLecture('lecture')).transcript, 'text-1\n\ntext-2');
    assert((await store.getAllChunks('lecture')).every(c => !c.blob && c.attempts === 1));
    assert.equal(progress.at(-1).completed, 2); assert.equal(progress.at(-1).total, 2);
    await store.close();
});
test('cancel aborts an active request and rejects late results without deleting audio', async () => {
    const entered = deferred(), release = deferred(); let signal;
    const {store, queue, seed} = await fixture({transcribe: async request => {signal = request.signal; entered.resolve(); await release.promise; return {text: 'late'};}});
    await seed(0);
    const work = queue.drain('lecture'); const rejected = assert.rejects(work, {name: 'AbortError'});
    await entered.promise; const cancellation = queue.cancel('lecture'); assert(signal.aborted);
    release.resolve(); await cancellation; await rejected;
    assert.equal((await store.getLecture('lecture')).transcript, '');
    assert((await store.getAllChunks('lecture'))[0].blob);
    await assert.rejects(queue.drain('lecture'), {name: 'AbortError'});
    await store.close();
});
test('transient retries are bounded, deadlines persist, and explicit retry resets budget', async () => {
    let now = 1000, calls = 0; const waits = [];
    const {store, queue, seed} = await fixture({now: () => now, random: () => 0,
        wait: async ms => {waits.push(ms); now += ms;}, transcribe: async () => {calls++; throw Object.assign(new Error('temporary'), {kind: 'rate_limit', retryable: true, retryAfterMs: 120000});}});
    await seed(0);
    await assert.rejects(queue.drain('lecture'));
    assert.equal(calls, 4); assert.deepEqual(waits, [120000, 120000, 120000]);
    let [chunk] = await store.getAllChunks('lecture'); assert.equal(chunk.status, 'failed'); assert.equal(chunk.attempts, 4); assert(chunk.blob);
    await assert.rejects(queue.resume('lecture')); assert.equal(calls, 4);
    await assert.rejects(queue.retry('lecture')); assert.equal(calls, 8);
    await store.close();
});
test('authentication stops immediately, retains audio and excludes raw diagnostics', async () => {
    let calls = 0;
    const {store, queue, seed} = await fixture({transcribe: async () => {calls++; throw Object.assign(new Error('secret-key raw response'), {kind: 'auth'});}});
    await seed(0); await assert.rejects(queue.drain('lecture'), {kind: 'auth'});
    await assert.rejects(queue.drain('lecture')); assert.equal(calls, 1);
    const [chunk] = await store.getAllChunks('lecture'); assert.equal(chunk.status, 'failed'); assert(chunk.blob); assert(!chunk.error.includes('secret'));
    await store.close();
});
test('storage-full enqueue retains RAM audio for export and retry before any provider request', async () => {
    let full = true, calls = 0;
    const {store, seed} = await fixture();
    const queue = new Queue({store: {...store, putChunk: (...args) => full ? Promise.reject(new DOMException('full', 'QuotaExceededError')) : store.putChunk(...args)}, online: () => true,
        transcribe: async () => {calls++; return {text: 'saved'};}});
    await assert.rejects(queue.enqueue({lectureId: 'lecture', index: 0, blob: new Blob(['retain me'])}), {kind: 'storage'});
    assert.equal(calls, 0); assert.equal(await (await queue.getRetainedAudio('lecture'))[0].blob.text(), 'retain me');
    full = false; await queue.retry('lecture');
    assert.equal(calls, 1); assert.equal((await queue.getRetainedAudio('lecture')).length, 0);
    await store.close();
});
test('resume recovers processing without resetting attempts or a future retry deadline', async () => {
    let now = 1000; const waits = [];
    const {store, queue} = await fixture({now: () => now, wait: async ms => {waits.push(ms); now += ms;}, transcribe: async () => ({text: 'recovered'})});
    await store.putChunk({lectureId: 'lecture', index: 0, blob: new Blob(['a']), status: 'processing', attempts: 2, nextAttemptAt: 6000});
    await queue.resume('lecture');
    assert.deepEqual(waits, [5000]); assert.equal((await store.getAllChunks('lecture'))[0].attempts, 3);
    await store.close();
});

test('offline waits without spending attempts, then drains newly accepted work', async () => {
    let online = false, calls = 0;
    const waiting = deferred(), reconnect = deferred();
    const {store, queue, seed} = await fixture({online: () => online,
        wait: async () => {waiting.resolve(); await reconnect.promise;}, transcribe: async () => {calls++; return {text: `part${calls}`};}});
    await seed(0); const events = []; const unsubscribe = queue.subscribe(e => events.push(e));
    const work = queue.drain('lecture'); await waiting.promise;
    await queue.enqueue({lectureId: 'lecture', index: 1, blob: new Blob(['second'])});
    assert.equal(calls, 0); assert.equal((await store.getAllChunks('lecture'))[0].attempts, 0);
    online = true; reconnect.resolve(); await work;
    assert.equal(calls, 2); assert.equal(events.at(-1).total, 2); assert.equal(events.at(-1).completed, 2);
    unsubscribe(); const count = events.length; await queue.drain('lecture'); assert.equal(events.length, count);
    await store.close();
});

test('failed transcript commit retains audio and never retries the provider automatically', async () => {
    let calls = 0;
    const {store, seed} = await fixture(); await seed(0);
    const queue = new Queue({store: {...store, completeChunk: async () => {throw new DOMException('full', 'QuotaExceededError');}}, online: () => true,
        transcribe: async () => {calls++; return {text: 'not committed'};}});
    await assert.rejects(queue.drain('lecture'), {kind: 'storage'});
    assert.equal(calls, 1); assert.equal((await store.getLecture('lecture')).transcript, ''); assert((await store.getAllChunks('lecture'))[0].blob);
    await store.close();
});

test('aborted storage mutations reject and repeated completion cannot replace saved text', async () => {
    const {store, seed} = await fixture(); await seed(0);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(store.completeChunk('lecture_0', {text: 'late'}, {signal: controller.signal}), {name: 'AbortError'});
    assert((await store.getAllChunks('lecture'))[0].blob);
    await store.completeChunk('lecture_0', {text: 'first'});
    await store.completeChunk('lecture_0', {text: 'duplicate'});
    assert.equal((await store.getLecture('lecture')).transcript, 'first');
    await store.close();
});

test('discard removes persisted and RAM audio and refuses late enqueue', async () => {
    const {store, seed} = await fixture(); await seed(0);
    const queue = new Queue({store: {...store, putChunk: async () => {throw new Error('full');}}});
    await assert.rejects(queue.enqueue({lectureId: 'lecture', index: 1, blob: new Blob(['ram'])}));
    await queue.discard('lecture');
    assert.equal(await store.getLecture('lecture'), undefined); assert.equal((await queue.getRetainedAudio('lecture')).length, 0);
    assert.throws(() => queue.enqueue({lectureId: 'lecture', index: 2, blob: new Blob(['late'])}), {name: 'AbortError'});
    await store.close();
});
