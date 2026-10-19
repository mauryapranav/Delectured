import {encodeAudio} from './encoder.js';
import {throwIfAborted} from './providers/http.js';

export const UPLOAD_LIMITS = Object.freeze({bytes: 500 * 1024 * 1024, seconds: 7200, channels: 2, sampleRate: 16000, chunkSeconds: 300});
export const uploadError = (reason, message) => Object.assign(new Error(message), {kind:'input', reason});
export function validateUpload(file) {
    if (!(file instanceof Blob) || !file.size) throw uploadError('empty_file', 'Choose a non-empty audio file.');
    if (file.size > UPLOAD_LIMITS.bytes) throw uploadError('file_size', 'Uploads are limited to 500 MiB. Split the file locally first.');
    if (!/\.(mp3|m4a|wav|mp4)$/i.test(file.name ?? '')) throw uploadError('file_format', 'Choose an MP3, M4A, WAV, or MP4 file.');
}

// Verify every source byte with a hash chain, using only 1 MiB per read.
export async function fingerprintUpload(file, signal, progress = () => {}) {
    let digest = new Uint8Array(32);
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
        throwIfAborted(signal);
        const bytes = new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer());
        const block = new Uint8Array(digest.length + bytes.length); block.set(digest); block.set(bytes, digest.length);
        digest = new Uint8Array(await crypto.subtle.digest('SHA-256', block));
        progress({phase:'verify', fraction:Math.min(1, (offset + bytes.length) / file.size)});
    }
    throwIfAborted(signal);
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function uploadLecture(file, {onChunk, signal, encode = encodeAudio, open, resample,
    startIndex = 0, startSeconds = startIndex * UPLOAD_LIMITS.chunkSeconds, onProgress = () => {}} = {}) {
    validateUpload(file); throwIfAborted(signal);
    if (!open || !resample) {
        const reader = await import('./upload-reader.js');
        open ??= reader.openUpload; resample ??= reader.resampleUpload;
    }
    let source;
    try {source = await open(file, signal);} catch {throwIfAborted(signal); throw uploadError('decode', 'This browser cannot decode this file. Try converting it to MP3 or PCM WAV.');}
    try {
        const {seconds, sampleRate, channels} = source;
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > UPLOAD_LIMITS.seconds || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || channels < 1 || channels > 2)
            throw uploadError('duration', 'Choose mono/stereo audio up to two hours, with a sample rate between 8 and 96 kHz.');
        const totalFrames = Math.round(seconds * sampleRate), blockFrames = sampleRate * 30;
        let cursor = Math.round(startSeconds * sampleRate), blockStart = cursor;
        let block = new Float32Array(Math.min(blockFrames, Math.max(0, totalFrames - cursor)));
        const capacity = chunkStart => {
            const remaining = seconds - chunkStart;
            // Keep sub-quarter-second encoder padding with the preceding part.
            return Math.round((remaining > 300 && remaining <= 300.25 ? remaining : Math.min(300,Math.max(0,remaining))) * UPLOAD_LIMITS.sampleRate);
        };
        let pcm = new Float32Array(capacity(startSeconds));
        let used = 0, index = startIndex;
        async function emit() {
            const length = used;
            onProgress({phase:'compress', index, total:Math.ceil(seconds / UPLOAD_LIMITS.chunkSeconds)});
            const blob = await encode(pcm.subarray(0, length), UPLOAD_LIMITS.sampleRate, {signal});
            throwIfAborted(signal);
            onProgress({phase:'transcribe', index, total:Math.ceil(seconds / UPLOAD_LIMITS.chunkSeconds)});
            await onChunk({index, startMs:(startSeconds + (index - startIndex) * UPLOAD_LIMITS.chunkSeconds) * 1000,
                durationMs:length / UPLOAD_LIMITS.sampleRate * 1000, overlapMs:0, blob});
            index++; used = 0;
            pcm = new Float32Array(capacity(startSeconds + (index - startIndex) * UPLOAD_LIMITS.chunkSeconds));
        }
        async function flush() {
            throwIfAborted(signal);
            const converted = await resample(block, sampleRate, UPLOAD_LIMITS.sampleRate);
            pcm.set(converted, used); used += converted.length;
            if (used === pcm.length) await emit();
            blockStart += block.length;
            block = new Float32Array(Math.min(blockFrames, Math.max(0, totalFrames - blockStart)));
            onProgress({phase:'prepare', index, total:Math.ceil(seconds / UPLOAD_LIMITS.chunkSeconds)});
        }
        try {
            for await (const {audio, timestamp} of source.samples(cursor / sampleRate)) {
                throwIfAborted(signal);
                if (audio.sampleRate !== sampleRate || audio.numberOfChannels !== channels || !Number.isFinite(timestamp)) throw uploadError('decode', 'The audio format changed inside this file. Convert it to WAV or MP3.');
                const frame = Math.round(timestamp * sampleRate), end = Math.min(totalFrames, frame + audio.length);
                // Keep timestamp gaps as silence; skip only already consumed frames.
                while (cursor < end) {
                    if (!block.length) break;
                    const stop = Math.min(end, blockStart + block.length), begin = Math.max(cursor, frame);
                    for (let channel = 0; channel < channels; channel++) {
                        const data = audio.getChannelData(channel);
                        for (let pos = begin; pos < stop; pos++) block[pos - blockStart] += data[pos - frame] / channels;
                    }
                    cursor = stop;
                    if (cursor === blockStart + block.length) await flush();
                }
            }
        } catch (error) {throwIfAborted(signal); if (error.kind || error.name === 'AbortError') throw error; throw uploadError('decode', 'The audio could not be read completely. Convert the original file to MP3 or WAV.');}
        if (totalFrames - cursor > Math.max(sampleRate / 10, 1)) throw uploadError('decode', 'The audio ended before its declared duration. Convert the original file before retrying.');
        if (block.length && cursor > blockStart) {block = block.subarray(0, cursor - blockStart); await flush();}
        if (used) await emit();
        throwIfAborted(signal);
        return {durationMs:seconds * 1000};
    } finally {source.close();}
}
