import {PCMChunker} from './pcm-chunker.js';
import {encodeAudio, encodeWav} from './encoder.js';
import {throwIfAborted} from './providers/http.js';

export class Recorder {
    constructor(onChunkReady, {encode = encodeAudio, onInterruption = () => {}, ...boundaries} = {}) {
        Object.assign(this, {onChunkReady, encode, onInterruption, boundaries});
        this.controller = new AbortController(); this.encoding = Promise.resolve(); this.pending = 0;
        this.isRecording = false; this.stopping = null; this.starting = null; this.encodingError = null;
        this.audioContext = null; this.stream = null; this.workletNode = null; this.wake = null;
        this.interrupted = false; this.discarded = false;
    }
    start() {
        if (this.starting) return this.starting;
        this.starting = this.open(); return this.starting;
    }
    async open() {
        const signal = this.controller.signal;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true}});
            if (signal.aborted) {stream.getTracks().forEach(t => t.stop()); throwIfAborted(signal);}
            this.stream = stream;
            this.audioContext = new AudioContext({sampleRate: 16000});
            await this.audioContext.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
            throwIfAborted(signal);
            this.chunker = new PCMChunker(chunk => this.schedule(chunk), {...this.boundaries, sampleRate: this.audioContext.sampleRate});
            this.workletNode = new AudioWorkletNode(this.audioContext, 'recorder-worklet');
            this.workletNode.port.onmessage = event => {
                if (event.data.type === 'flushed') {this.flushed?.(); return;}
                if (this.isRecording && !this.discarded && event.data.type === 'samples') this.chunker.push(event.data.samples);
            };
            this.workletNode.onprocessorerror = () => this.interrupt('processor');
            this.source = this.audioContext.createMediaStreamSource(stream);
            this.source.connect(this.workletNode); this.workletNode.connect(this.audioContext.destination);
            await this.audioContext.resume(); throwIfAborted(signal);
            this.isRecording = true;
            this.audioContext.onstatechange = () => {if (this.isRecording && !this.stopping && this.audioContext.state !== 'running') this.interrupt('suspended');};
            for (const track of stream.getTracks()) {track.onended = () => this.interrupt('microphone'); track.onmute = () => this.interrupt('microphone');}
            this.visibility = () => {if (document.visibilityState === 'visible') this.requestWake();};
            this.pagehide = () => this.interrupt('page-hidden');
            document.addEventListener('visibilitychange', this.visibility); globalThis.addEventListener('pagehide', this.pagehide);
            this.requestWake();
        } catch (error) {await this.cleanup(); throw error;}
    }
    async requestWake() {
        if (!this.isRecording || this.wake || this.requestingWake || document.visibilityState !== 'visible') return;
        this.requestingWake = true;
        try {
            const wake = await navigator.wakeLock?.request('screen');
            if (!this.isRecording || this.stopping) await wake?.release();
            else {this.wake = wake; wake?.addEventListener('release', () => {if (this.wake === wake) this.wake = null;});}
        } catch { /* Wake lock is optional; recording continues without it. */ }
        finally {this.requestingWake = false;}
    }
    interrupt(reason) {
        if (this.interrupted || this.discarded) return;
        this.interrupted = true;
        this.onInterruption({reason, atMs: this.durationMs});
        this.stop().catch(() => {});
    }
    get durationMs() {return (this.chunker?.totalSamples ?? 0) / (this.chunker?.sampleRate ?? 16000) * 1000;}
    schedule(chunk) {
        if (this.discarded) return;
        this.pending++;
        // Encode serially to bound worker/PCM memory; callback order equals capture order.
        this.encoding = this.encoding.then(async () => {
            throwIfAborted(this.controller.signal);
            let blob;
            try {blob = await this.encode(chunk.pcmData, chunk.sampleRate, {signal: this.controller.signal});}
            catch (error) {
                throwIfAborted(this.controller.signal);
                blob = encodeWav(chunk.pcmData, chunk.sampleRate); this.interrupt('encoder');
            }
            throwIfAborted(this.controller.signal);
            const {pcmData, sampleRate, ...metadata} = chunk;
            await this.onChunkReady({...metadata, blob});
        }).catch(error => {this.encodingError = error; if (!this.discarded) this.interrupt('storage');})
            .finally(() => {this.pending--;});
        if (this.pending >= 2 && this.isRecording && !this.stopping) this.interrupt('encoding-backlog');
    }
    stop() {
        if (this.stopping) return this.stopping;
        this.stopping = Promise.resolve().then(() => this.finishStop()); return this.stopping;
    }
    async finishStop() {
        if (!this.isRecording) {
            // Stop during a permission prompt must prevent late startup.
            if (this.starting && !this.chunker) this.controller.abort();
            await this.cleanup(); await this.encoding;
            if (this.encodingError) throw this.encodingError; return;
        }
        try {
            if (this.workletNode && !this.discarded) {
                await new Promise(resolve => {
                    const timer = setTimeout(() => {this.interrupt('flush-timeout'); resolve();}, 2000);
                    this.flushed = () => {clearTimeout(timer); resolve();};
                    this.workletNode.port.postMessage({type: 'flush'});
                });
            }
            this.isRecording = false;
            if (!this.discarded) this.chunker?.flush();
        } finally {await this.cleanup();}
        await this.encoding; this.chunker?.clear();
        if (this.encodingError) throw this.encodingError;
    }
    async discard() {
        this.discarded = true; this.isRecording = false; this.controller.abort(); this.flushed?.();
        this.chunker?.clear(); await this.cleanup(); await this.encoding;
    }
    async cleanup() {
        this.isRecording = false;
        if (this.stream) for (const track of this.stream.getTracks()) {track.onended = null; track.onmute = null; track.stop();}
        this.source?.disconnect(); this.workletNode?.disconnect();
        if (this.audioContext) {
            this.audioContext.onstatechange = null;
            if (this.audioContext.state !== 'closed') await this.audioContext.close().catch(() => {});
        }
        await this.wake?.release().catch(() => {}); this.wake = null;
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
        globalThis.removeEventListener?.('pagehide', this.pagehide);
    }
}
