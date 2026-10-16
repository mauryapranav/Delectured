import * as defaultStore from './store.js';
import {transcribeAudio} from './providers/index.js';
import {getProviderMetadata} from './providers/catalog.js';
import {aborted, throwIfAborted} from './providers/http.js';
import {validateChunk} from './schema.js';

const messages = {
    auth: 'The API key or access permissions need attention. Fix them in Keys, then retry.',
    quota: 'The provider account has no remaining quota or credit. Check the account before retrying.',
    rate_limit: 'The rate limit was reached. Automatic attempts are exhausted; retry later.',
    network: 'The connection or provider is unavailable. Automatic attempts are exhausted.',
    unsupported: 'The configured provider cannot handle this request. Check its model and audio support.',
    response: 'The provider returned an unusable response. Audio has been retained.',
    storage: 'Audio or its transcript could not be saved. Free device space, then retry, or export the audio. Keep this tab open.',
    blocked: 'Processing is blocked. Retry, export the retained audio, or discard it.',
};
export class QueueError extends Error {
    constructor(kind = 'blocked') {
        kind = Object.hasOwn(messages, kind) ? kind : 'blocked';
        super(messages[kind]); this.name = 'QueueError'; this.kind = kind;
    }
}
export function waitForQueue(ms, signal) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const finish = () => {cleanup(); resolve();};
        const cancel = () => {cleanup(); reject(aborted());};
        const timer = setTimeout(finish, Math.min(ms, 2147483647));
        const cleanup = () => {clearTimeout(timer); signal?.removeEventListener('abort', cancel); globalThis.removeEventListener?.('online', finish);};
        signal?.addEventListener('abort', cancel, {once: true});
        globalThis.addEventListener?.('online', finish, {once: true});
    });
}
// The browser lock serializes requests across tabs as well as Queue instances.
async function withLectureLock(id, signal, work) {
    if (globalThis.navigator?.locks) return navigator.locks.request(`delectured-queue:${id}`, {signal}, work);
    if (typeof window !== 'undefined') throw new QueueError('unsupported');
    return work(); // Node test harness; each fixture owns an isolated database.
}

export class Queue {
    constructor({store = defaultStore, transcribe = transcribeAudio, online = () => globalThis.navigator?.onLine !== false,
        now = Date.now, random = Math.random, wait = waitForQueue, lock = withLectureLock, maxAttempts = 4} = {}) {
        if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new TypeError('Invalid attempt limit.');
        Object.assign(this, {store, transcribe, online, now, random, wait, lock, maxAttempts});
        this.states = new Map(); this.listeners = new Set();
    }
    get isProcessing() {return [...this.states.values()].some(state => state.promise);}
    state(id) {
        if (!this.states.has(id)) this.states.set(id, {controller: new AbortController(), promise: null, writes: new Set(), memory: new Map(), revision: 0, observed: 0, blocked: null});
        return this.states.get(id);
    }
    subscribe(listener) {this.listeners.add(listener); return () => this.listeners.delete(listener);}
    onProgress(listener) {return this.subscribe(e => listener(e.lectureId, e.completed, e.total, e.online));}
    emit(event) {for (const listener of this.listeners) {try {listener(event);} catch { /* UI errors cannot corrupt the queue. */ }}}
    async progress(id, status, error, nextAttemptAt = 0) {
        const state = this.state(id);
        let chunks = [];
        try {chunks = await this.store.getAllChunks(id);} catch { /* RAM remains exportable if storage cannot be read. */ }
        const all = new Map(chunks.map(c => [c.id, c]));
        for (const [key, chunk] of state.memory) all.set(key, chunk);
        this.emit({lectureId: id, status, error, nextAttemptAt, online: this.online(),
            completed: [...all.values()].filter(c => c.status === 'transcribed').length, total: all.size, unsaved: state.memory.size});
    }
    hasUnsavedAudio() {return [...this.states.values()].some(s => s.memory.size);}
    enqueue(value) {
        const chunk = validateChunk({...value, status: 'pending', attempts: 0, nextAttemptAt: 0});
        const state = this.state(chunk.lectureId), signal = state.controller.signal;
        throwIfAborted(signal);
        if (state.memory.has(chunk.id)) return Promise.reject(new QueueError('blocked'));
        state.revision++;
        state.memory.set(chunk.id, chunk);
        const write = this.store.putChunk(chunk, {signal}).then(() => {state.memory.delete(chunk.id);}, async () => {
            if (signal.aborted) throw aborted();
            state.blocked = new QueueError('storage');
            await this.progress(chunk.lectureId, 'blocked', state.blocked);
            throw state.blocked;
        }).finally(() => state.writes.delete(write));
        state.writes.add(write);
        return write.then(() => {this.drain(chunk.lectureId).catch(() => {}); return chunk;});
    }
    processQueue(id) {return this.drain(id);}
    drain(id) {
        const state = this.state(id);
        if (state.controller.signal.aborted) return Promise.reject(aborted());
        if (state.promise) return state.promise;
        if (state.blocked) return Promise.reject(state.blocked);
        state.promise = this.lock(id, state.controller.signal, () => this.run(id, state)).catch(async error => {
            if (!state.controller.signal.aborted) {
                state.blocked = error instanceof QueueError ? error : new QueueError('storage');
                await this.progress(id, 'blocked', state.blocked);
                throw state.blocked;
            }
            throw aborted();
        }).finally(() => {
            state.promise = null;
            if (!state.blocked && !state.controller.signal.aborted && state.observed !== state.revision) this.drain(id).catch(() => {});
        });
        return state.promise;
    }
    async run(id, state) {
        const signal = state.controller.signal;
        // Under the lock, processing records belong to an interrupted worker.
        for (const chunk of await this.store.getAllChunks(id)) {
            throwIfAborted(signal);
            if (chunk.status === 'processing') await this.store.putChunk({...chunk, status: 'pending'}, {signal});
        }
        while (true) {
            throwIfAborted(signal);
            await Promise.all([...state.writes]);
            if (state.blocked) throw state.blocked;
            if (state.memory.size) throw new QueueError('storage');
            const revision = state.revision;
            const chunks = await this.store.getAllChunks(id);
            if (revision !== state.revision || state.writes.size) continue;
            state.observed = revision;
            const chunk = chunks.find(c => c.status !== 'transcribed');
            if (!chunk) {
                await this.progress(id, 'complete');
                if (revision !== state.revision || state.writes.size) continue;
                return;
            }
            if (chunk.status === 'failed') throw new QueueError(chunk.error);
            if (chunk.attempts >= this.maxAttempts) {
                await this.store.putChunk({...chunk, status: 'failed', error: chunk.error || 'network'}, {signal});
                throw new QueueError(chunk.error || 'network');
            }
            if (!this.online()) {await this.progress(id, 'offline'); await this.wait(5000, signal); continue;}
            const delay = chunk.nextAttemptAt - this.now();
            if (delay > 0) {await this.progress(id, 'waiting', undefined, chunk.nextAttemptAt); await this.wait(delay, signal); continue;}
            const lecture = await this.store.getLecture(id);
            if (!lecture) throw aborted();
            const active = {...chunk, status: 'processing', attempts: chunk.attempts + 1, nextAttemptAt: 0};
            await this.store.putChunk(active, {signal});
            await this.progress(id, 'processing');
            const selection = lecture.providerSelections?.transcription ?? {providerId: 'groq', model: getProviderMetadata('groq').defaults.transcription};
            let result;
            try {
                throwIfAborted(signal);
                result = await this.transcribe({blob: chunk.blob, language: lecture.language, ...selection, signal});
            } catch (error) {
                throwIfAborted(signal);
                const kind = Object.hasOwn(messages, error.kind) ? error.kind : 'response';
                const retry = error.retryable && ['network', 'rate_limit'].includes(kind) && active.attempts < this.maxAttempts;
                const backoff = Math.min(30000, 1000 * 2 ** (active.attempts - 1)) + Math.floor(this.random() * 500);
                const retryAfter = Number.isFinite(error.retryAfterMs) ? Math.max(0, error.retryAfterMs) : 0;
                await this.store.putChunk({...active, status: retry ? 'pending' : 'failed', error: kind,
                    nextAttemptAt: retry || kind === 'rate_limit' ? this.now() + Math.max(backoff, retryAfter) : 0}, {signal});
                if (!retry) throw new QueueError(kind);
                continue;
            }
            // A storage failure must not be interpreted as another provider failure.
            throwIfAborted(signal);
            await this.store.completeChunk(chunk.id, result, {signal});
            await this.progress(id, 'processing');
        }
    }
    async cancel(id) {
        const state = this.state(id);
        state.controller.abort();
        await Promise.allSettled([...state.writes, ...(state.promise ? [state.promise] : [])]);
        await this.progress(id, 'cancelled');
    }
    async resume(id) {
        const state = this.state(id);
        if (state.promise) return state.promise;
        state.controller = new AbortController(); state.blocked = null;
        return this.drain(id);
    }
    async retry(id) {
        const state = this.state(id);
        await this.cancel(id);
        state.controller = new AbortController(); state.blocked = null;
        const signal = state.controller.signal;
        try {
            await this.lock(id, signal, async () => {
                for (const [key, chunk] of state.memory) {await this.store.putChunk(chunk, {signal}); state.memory.delete(key);}
                for (const chunk of await this.store.getAllChunks(id)) {
                    if (chunk.status !== 'transcribed') await this.store.putChunk({...chunk, status: 'pending', attempts: 0, error: undefined}, {signal});
                }
            });
        } catch (error) {
            if (signal.aborted) throw aborted();
            state.blocked = new QueueError('storage'); await this.progress(id, 'blocked', state.blocked); throw state.blocked;
        }
        return this.drain(id);
    }
    async getRetainedAudio(id) {
        const state = this.state(id);
        let chunks;
        try {chunks = await this.store.getAllChunks(id);} catch (error) {if (!state.memory.size) throw error; chunks = [];}
        const retained = new Map(chunks.filter(c => c.blob).map(c => [c.id, c]));
        for (const [key, chunk] of state.memory) retained.set(key, chunk);
        return [...retained.values()].sort((a, b) => a.index - b.index);
    }
    async discard(id) {
        await this.cancel(id);
        await this.store.deleteLecture(id);
        this.state(id).memory.clear();
        await this.progress(id, 'discarded');
    }
}
