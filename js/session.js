import {Recorder} from './recorder.js';
import * as defaultStore from './store.js';
import {uploadLecture, validateUpload} from './upload.js';
import {throwIfAborted, aborted} from './providers/http.js';

export class Session {
    constructor({queue, store = defaultStore, createRecorder = (callback, options) => new Recorder(callback, options), upload = uploadLecture, onState = () => {}}) {
        Object.assign(this, {queue, store, createRecorder, uploadSource: upload, onState}); this.active = null;
        queue.subscribe(event => {
            const run = this.active;
            if (run?.id === event.lectureId && event.status === 'blocked' && event.error.kind === 'storage') this.interrupt(run, {reason: 'storage', atMs: run.recorder?.durationMs ?? 0});
        });
    }
    get busy() {return !!this.active && !['complete', 'failed', 'discarded'].includes(this.active.state);}
    emit(run, state, error) {run.state = state; if (this.active === run) this.onState({id: run.id, state, error});}
    begin(options = {}) {
        if (this.busy) throw new Error('Finish or discard the current session first.');
        const run = {id: options.id ?? crypto.randomUUID(), controller: new AbortController(), state: 'starting', options, gaps: [], stopPromise: null};
        this.active = run; this.emit(run, 'starting'); return run;
    }
    async draft(run) {
        await this.store.saveLecture({id: run.id, title: run.options.title ?? 'Lecture Analysis', language: run.options.language,
            providerSelections: run.options.providerSelections, status: 'recording', transcript: ''});
        if (run.controller.signal.aborted) {await this.store.deleteLecture(run.id); throw aborted();}
    }
    async accept(run, chunk) {
        throwIfAborted(run.controller.signal);
        try {await this.queue.enqueue({...chunk, lectureId: run.id});}
        catch (error) {if (!run.controller.signal.aborted) this.interrupt(run, {reason: 'storage', atMs: chunk.startMs}); throw error;}
    }
    start(options) {
        const run = this.begin(options);
        run.work = (async () => {
            try {
                await this.draft(run);
                throwIfAborted(run.controller.signal);
                run.recorder = this.createRecorder(chunk => this.accept(run, chunk), {onInterruption: gap => this.interrupt(run, gap)});
                await run.recorder.start(); throwIfAborted(run.controller.signal);
                this.emit(run, 'recording'); return run.id;
            } catch (error) {await this.fail(run, error); throw error;}
        })(); return run.work;
    }
    interrupt(run, gap) {
        if (run.controller.signal.aborted || run.gaps.some(g => g.reason === gap.reason)) return;
        run.gaps.push({...gap, durationMs: null});
        this.emit(run, 'interrupted');
        // Never await stop inside a persistence/encoder callback.
        run.recorder?.stop().catch(() => {});
        run.uploadController?.abort();
        this.store.updateLecture(run.id, {status: 'interrupted', captureGaps: run.gaps}).catch(() => {});
    }
    stop() {
        const run = this.active;
        if (!run) return Promise.reject(new Error('No active session.'));
        if (run.state === 'complete') return Promise.resolve(run.id);
        if (['uploading', 'processing'].includes(run.state) && run.work && !run.recorder) return run.work;
        if (run.stopPromise) return run.stopPromise;
        run.stopPromise = (async () => {
            try {
                if (run.state === 'starting') {await this.discard(); throw aborted();}
                this.emit(run, 'stopping'); await run.recorder?.stop(); throwIfAborted(run.controller.signal);
                await this.store.updateLecture(run.id, {status: run.gaps.length ? 'interrupted' : 'processing', durationMs: run.recorder?.durationMs ?? 0, captureGaps: run.gaps});
                this.emit(run, 'processing'); await this.queue.drain(run.id); throwIfAborted(run.controller.signal);
                this.emit(run, 'complete'); return run.id;
            } catch (error) {await this.fail(run, error); throw error;}
        })(); return run.stopPromise;
    }
    async fail(run, error) {
        if (run.controller.signal.aborted) return;
        this.emit(run, 'failed', error);
        await this.store.updateLecture(run.id, {status: 'failed', captureGaps: run.gaps}).catch(() => {});
    }
    async discard() {
        const run = this.active; if (!run) return;
        run.controller.abort(); run.uploadController?.abort(); this.emit(run, 'discarding');
        const cancel = this.queue.cancel(run.id);
        await run.recorder?.discard(); await cancel; await this.queue.discard(run.id);
        this.emit(run, 'discarded');
    }
    async recover(id, {retry = false} = {}) {
        if (this.busy && (this.active?.id !== id || ['starting', 'uploading', 'processing', 'stopping', 'discarding'].includes(this.active.state))) throw new Error('Finish the current session first.');
        if (this.active?.id === id && this.active.recorder?.isRecording) throw new Error('Stop recording before recovery.');
        const previous = this.active;
        const run = {id, controller: new AbortController(), state: 'processing', gaps: []};
        this.active = run; this.emit(run, 'processing');
        const signal = run.controller.signal;
        try {
            if (previous?.id === id) await previous.recorder?.stop().catch(() => {});
            throwIfAborted(signal);
            const lecture = await this.store.getLecture(id); throwIfAborted(signal);
            if (!lecture) throw new Error('Recording no longer exists.');
            run.gaps = lecture.captureGaps ?? [];
            const chunks = await this.store.getAllChunks(id); throwIfAborted(signal);
            const durationMs = chunks.reduce((end, c) => Math.max(end, c.startMs + c.durationMs), lecture.durationMs ?? 0);
            if (lecture.status === 'recording' && !run.gaps.some(g => g.reason === 'reload')) {
                run.gaps.push({reason: 'reload', atMs: durationMs, durationMs: null});
            }
            await this.store.updateLecture(id, {status: 'interrupted', captureGaps: run.gaps, durationMs}, {signal}); throwIfAborted(signal);
            await (retry ? this.queue.retry(id) : this.queue.resume(id)); throwIfAborted(signal);
            this.emit(run, 'complete'); return id;
        }
        catch (error) {await this.fail(run, error); throw error;}
    }
    upload(file, options) {
        validateUpload(file);
        const run = this.begin({...options, title: file.name});
        run.uploadController = new AbortController();
        run.work = (async () => {
            try {
                await this.draft(run); throwIfAborted(run.controller.signal); this.emit(run, 'uploading');
                const result = await this.uploadSource(file, {onChunk: chunk => this.accept(run, chunk), signal: run.uploadController.signal});
                throwIfAborted(run.controller.signal);
                await this.store.updateLecture(run.id, {durationMs: result.durationMs, status: 'processing'});
                this.emit(run, 'processing'); await this.queue.drain(run.id); throwIfAborted(run.controller.signal);
                this.emit(run, 'complete'); return run.id;
            } catch (error) {
                if (!run.controller.signal.aborted) run.gaps.push({atMs: 0, durationMs: null, reason: 'upload-incomplete'});
                await this.fail(run, error); throw error;
            }
        })(); return run.work;
    }
}
