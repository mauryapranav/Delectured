import {encodeAudio} from './encoder.js';
import {throwIfAborted, aborted} from './providers/http.js';

export const UPLOAD_LIMITS = Object.freeze({bytes: 20 * 1024 * 1024, seconds: 600, channels: 2, sampleRate: 16000, chunkSeconds: 300});
export function validateUpload(file) {
    if (!(file instanceof Blob) || !file.size) throw new Error('Choose a non-empty audio file.');
    if (file.size > UPLOAD_LIMITS.bytes) throw new Error('Uploads are limited to 20 MiB. Split the file locally first.');
    if (!/\.(mp3|m4a|wav|mp4)$/i.test(file.name ?? '')) throw new Error('Choose an MP3, M4A, WAV, or MP4 file.');
}
export function mediaDuration(file, signal) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const media = document.createElement('audio'), url = URL.createObjectURL(file);
        const cleanup = () => {clearTimeout(timer); signal?.removeEventListener('abort', cancel); media.onloadedmetadata = null; media.onerror = null; media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url);};
        const fail = error => {cleanup(); reject(error);};
        const cancel = () => fail(aborted());
        const timer = setTimeout(() => fail(new Error('Could not inspect this audio file.')), 15000);
        media.onloadedmetadata = () => {const duration = media.duration; cleanup(); resolve(duration);};
        media.onerror = () => fail(new Error('This browser cannot read the selected audio format.'));
        signal?.addEventListener('abort', cancel, {once: true}); media.preload = 'metadata'; media.src = url;
    });
}
export async function uploadLecture(file, {onChunk, signal, encode = encodeAudio, probe = mediaDuration,
    decode = bytes => new OfflineAudioContext(1, 1, UPLOAD_LIMITS.sampleRate).decodeAudioData(bytes)} = {}) {
    validateUpload(file); throwIfAborted(signal);
    const seconds = await probe(file, signal); throwIfAborted(signal);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > UPLOAD_LIMITS.seconds) throw new Error('Uploads must have a known duration of at most 10 minutes.');
    const bytes = await file.arrayBuffer(); throwIfAborted(signal);
    let audio;
    try {audio = await decode(bytes);} catch {throw new Error('This browser could not decode the audio. Try a WAV or MP3 file.');}
    throwIfAborted(signal);
    if (audio.duration > UPLOAD_LIMITS.seconds || audio.numberOfChannels > UPLOAD_LIMITS.channels || audio.sampleRate !== UPLOAD_LIMITS.sampleRate || !audio.length) throw new Error('Decoded audio exceeds the supported 10-minute, mono/stereo limit.');
    const count = UPLOAD_LIMITS.chunkSeconds * audio.sampleRate;
    for (let start = 0, index = 0; start < audio.length; start += count, index++) {
        throwIfAborted(signal);
        const length = Math.min(count, audio.length - start), pcm = new Float32Array(length);
        for (let channel = 0; channel < audio.numberOfChannels; channel++) {
            const data = audio.getChannelData(channel);
            for (let i = 0; i < length; i++) pcm[i] += data[start + i] / audio.numberOfChannels;
        }
        const blob = await encode(pcm, audio.sampleRate, {signal}); throwIfAborted(signal);
        await onChunk({index, startMs: start / audio.sampleRate * 1000, durationMs: length / audio.sampleRate * 1000, overlapMs: 0, blob});
    }
    return {durationMs: audio.duration * 1000};
}
