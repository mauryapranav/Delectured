/**
 * js/encoder.worker.js
 * Web Worker for MP3 Encoding using lamejs
 */

self.importScripts('./vendor/lamejs/lame.min.js');

self.onmessage = function (e) {
    const { pcmData, sampleRate, kbps } = e.data;
    
    try {
        const mp3Blob = encodeToMp3(pcmData, sampleRate, kbps);
        self.postMessage({ status: 'done', blob: mp3Blob });
    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
};

function encodeToMp3(pcmData, sampleRate, kbps) {
    const channels = 1;
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const mp3Data = [];

    // pcmData is Float32Array [-1, 1], lamejs needs Int16Array [-32768, 32767]
    const samples = new Int16Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
        let val = pcmData[i] * 32768;
        if (val < -32768) val = -32768;
        if (val > 32767) val = 32767;
        samples[i] = val;
    }

    const sampleBlockSize = 1152; 
    for (let i = 0; i < samples.length; i += sampleBlockSize) {
        const sampleChunk = samples.subarray(i, i + sampleBlockSize);
        const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
        if (mp3buf.length > 0) {
            mp3Data.push(new Int8Array(mp3buf));
        }
    }
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(new Int8Array(mp3buf));
    }

    return new Blob(mp3Data, { type: 'audio/mpeg' });
}
