import {aborted, throwIfAborted} from './providers/http.js';

export function encodeAudio(pcmData, sampleRate, {signal, timeoutMs = 120000} = {}) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./encoder.worker.js', import.meta.url));
        const cleanup = () => {clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', cancel);};
        const fail = error => {cleanup(); reject(error);};
        const cancel = () => fail(aborted());
        const timer = setTimeout(() => fail(new Error('Audio encoding timed out.')), timeoutMs);
        signal?.addEventListener('abort', cancel, {once: true});
        worker.onmessage = event => {
            if (event.data.status !== 'done' || !(event.data.blob instanceof Blob)) return fail(new Error('Audio encoding failed.'));
            cleanup(); resolve(event.data.blob);
        };
        worker.onerror = () => fail(new Error('Audio encoding failed.'));
        // Keep PCM until success so a failed encoder can fall back to WAV without data loss.
        try {worker.postMessage({pcmData, sampleRate, kbps: 64});} catch (error) {fail(error);}
    });
}

export function encodeWav(samples, sampleRate) {
    const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
    const text = (at, value) => {for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));};
    text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, samples[i] * 32768)), true);
    return new Blob([bytes], {type: 'audio/wav'});
}
