// Local fixtures only. No provider spending or microphone recording.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {analysisFixture} from '../tests/analysis-fixture.js';
const {chromium} = await import(pathToFileURL(process.argv[2]));
const root = resolve('.');
const server = createServer(async (request, response) => {
    try {
        const path = resolve(root, '.' + (new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname));
        if (!path.startsWith(root + sep)) throw new Error('Invalid path');
        response.setHeader('Content-Type', ({'.js': 'text/javascript', '.css': 'text/css'})[extname(path)] || 'text/html');
        response.end(await readFile(path));
    } catch {response.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({headless: true, executablePath: process.argv[3], args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});
    const context = await browser.newContext({permissions: ['microphone']});
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/index.html?capture=1');
    await page.evaluate(async () => {await navigator.serviceWorker.ready;});
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.evaluate(async () => {
        const {Recorder} = await import('/js/recorder.js'); window.chunks = [];
        window.capture = new Recorder(chunk => chunks.push(chunk), {targetMs: 250, maxExtraMs: 100, quietMs: 40, overlapMs: 20});
        await capture.start();
    });
    await page.waitForFunction(() => window.capture.durationMs > 850);
    const recording = await page.evaluate(async () => {
        await capture.stop();
        const decoder = new OfflineAudioContext(1, 1, 16000); const durations = [];
        for (const chunk of chunks) durations.push((await decoder.decodeAudioData(await chunk.blob.arrayBuffer())).duration);
        return {count: chunks.length, indexes: chunks.map(c => c.index), durations, metadata: chunks.map(c => c.durationMs),
            ended: capture.stream.getTracks().every(t => t.readyState === 'ended'), closed: capture.audioContext.state, pending: capture.pending};
    });
    assert(recording.count >= 3); assert.deepEqual(recording.indexes, recording.indexes.map((_, i) => i));
    assert(recording.durations.every(n => n > 0)); assert(recording.ended); assert.equal(recording.closed, 'closed'); assert.equal(recording.pending, 0);
    console.log('PASS: Real worklet/fake microphone crosses multiple accelerated boundaries, flushes tail, produces playable MP3, releases tracks/context');

    // With a primed local service worker, a new worklet and encoder still load offline.
    await context.setOffline(true);
    await page.evaluate(async () => {
        const {Session} = await import('/js/session.js'), {Queue} = await import('/js/queue.js'), {Recorder} = await import('/js/recorder.js');
        window.offlineQueue = new Queue({transcribe: async () => ({text: 'offline recording'})});
        window.offlineSession = new Session({queue: offlineQueue, createRecorder: (cb, opts) => new Recorder(cb, {...opts, targetMs: 250, maxExtraMs: 100, quietMs: 40, overlapMs: 20})});
        await offlineSession.start({id: 'offline-capture'});
    });
    await page.waitForFunction(() => offlineSession.active.recorder.durationMs > 400);
    await page.evaluate(() => {window.offlineStop = offlineSession.stop();});
    await page.waitForFunction(() => offlineSession.active.state === 'processing');
    const pending = await page.evaluate(async () => (await (await import('/js/store.js')).getAllChunks('offline-capture')).map(c => [c.status, !!c.blob]));
    assert(pending.length); assert(pending.every(([status, blob]) => status === 'pending' && blob));
    await context.setOffline(false); await page.evaluate(() => offlineStop);
    console.log('PASS: Offline capture loads local encoder, persists audio, then resumes transcription on reconnection');

    const uploaded = await page.evaluate(async () => {
        const {encodeWav} = await import('/js/encoder.js'), {uploadLecture} = await import('/js/upload.js');
        const pcm = new Float32Array(301 * 16000); for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i * .05) * .1;
        const file = new File([encodeWav(pcm, 16000)], 'fixture.wav'); const parts = [];
        const result = await uploadLecture(file, {onChunk: c => parts.push(c)});
        const decoder = new OfflineAudioContext(1, 1, 16000);
        const durations = []; for (const c of parts) durations.push((await decoder.decodeAudioData(await c.blob.arrayBuffer())).duration);
        // Exercise MP3 decoding as well as WAV; no provider requests.
        const mp3 = new File([parts[0].blob], 'fixture.mp3'); const again = [];
        await uploadLecture(mp3, {onChunk: c => again.push(c)});
        return {durationMs: result.durationMs, metadata: parts.map(c => [c.index, c.startMs, c.durationMs]), durations, again: again.length};
    });
    assert.equal(uploaded.durationMs, 301000); assert.deepEqual(uploaded.metadata, [[0, 0, 300000], [1, 300000, 1000]]);
    assert(uploaded.durations[0] >= 299 && uploaded.durations[1] >= .9); assert(uploaded.again >= 1);
    console.log('PASS: A 301-second WAV upload becomes independently playable MP3 parts; MP3 re-upload decodes');

    await page.evaluate(async () => {
        const {Recorder} = await import('/js/recorder.js'); window.interruptions = [];
        window.interrupted = new Recorder(() => {}, {onInterruption: gap => interruptions.push(gap)}); await interrupted.start();
        await interrupted.audioContext.suspend();
    });
    await page.waitForFunction(() => interruptions.length > 0);
    await page.evaluate(() => interrupted.stop());
    assert.equal(await page.evaluate(() => interruptions[0].reason), 'suspended');
    assert(await page.evaluate(() => interrupted.stream.getTracks().every(t => t.readyState === 'ended')));
    console.log('PASS: Suspended capture reports an interruption and releases microphone tracks');

    const denied = await page.evaluate(async () => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); const {Recorder} = await import('/js/recorder.js');
        navigator.mediaDevices.getUserMedia = async () => {throw new DOMException('Denied', 'NotAllowedError');};
        const recorder = new Recorder(() => {});
        try {await recorder.start(); return false;} catch (error) {return error.name === 'NotAllowedError' && !recorder.isRecording && !recorder.stream;}
        finally {navigator.mediaDevices.getUserMedia = original;}
    });
    assert(denied); console.log('PASS: Microphone denial fails without leaving capture active (permission fixture)');

    const discarded = await page.evaluate(async () => {
        const {Recorder} = await import('/js/recorder.js');
        const stream = await navigator.mediaDevices.getUserMedia({audio: true});
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let resolve;
        navigator.mediaDevices.getUserMedia = () => new Promise(r => {resolve = r;});
        const recorder = new Recorder(() => {throw new Error('Unexpected late audio');});
        const start = recorder.start().catch(error => error.name); await recorder.discard(); resolve(stream);
        const result = await start; navigator.mediaDevices.getUserMedia = original;
        return result === 'AbortError' && stream.getTracks().every(t => t.readyState === 'ended');
    });
    assert(discarded); console.log('PASS: Discard during a pending microphone prompt stops a late stream and suppresses startup');

    const containers = await page.evaluate(async () => {
        if (!MediaRecorder.isTypeSupported('audio/mp4')) return [];
        const context = new AudioContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
        oscillator.connect(destination); oscillator.start(); await context.resume();
        const recorder = new MediaRecorder(destination.stream, {mimeType: 'audio/mp4'}), data = [];
        const done = new Promise(resolve => {recorder.ondataavailable = event => data.push(event.data); recorder.onstop = resolve;});
        recorder.start(); await new Promise(resolve => setTimeout(resolve, 500)); recorder.stop(); await done;
        oscillator.stop(); destination.stream.getTracks().forEach(t => t.stop()); await context.close();
        const {uploadLecture} = await import('/js/upload.js'); const passed = [];
        for (const extension of ['m4a', 'mp4']) {
            const parts = []; await uploadLecture(new File(data, `fixture.${extension}`, {type: 'audio/mp4'}), {onChunk: c => parts.push(c)});
            if (parts.length) passed.push(extension);
        }
        return passed;
    });
    console.log(containers.length === 2 ? 'PASS: Generated M4A and MP4 audio containers decode and re-encode' : 'UNTESTED: This Chromium cannot generate an MP4 audio fixture');

    await context.route('https://api.groq.com/**', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(
        route.request().url().includes('transcriptions') ? {text: 'Uploaded lecture transcript', segments: []}
            : {choices: [{finish_reason: 'stop', message: {content: JSON.stringify(analysisFixture(JSON.parse(route.request().postDataJSON().messages[1].content), 'Upload notes'))}}]})}));
    await page.evaluate(async () => {
        const {saveConfig} = await import('/js/config.js'), {encodeWav} = await import('/js/encoder.js'); saveConfig({keys: {groq: 'fixture-key'}});
        const transfer = new DataTransfer(); transfer.items.add(new File([encodeWav(new Float32Array(16000), 16000)], 'ui-upload.wav'));
        const input = document.getElementById('file-input'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await page.waitForFunction(() => document.getElementById('result-section').classList.contains('active-view'));
    const appUpload = await page.evaluate(async () => {
        const store = await import('/js/store.js'); const lecture = (await store.getAllLectures()).find(l => l.title === 'ui-upload.wav');
        return {text: lecture.transcript, status: lecture.status, audio: (await store.getAllChunks(lecture.id)).some(c => c.blob)};
    });
    assert.deepEqual(appUpload, {text: 'Uploaded lecture transcript', status: 'ready', audio: false});
    console.log('PASS: Existing upload control runs decode, queue, mocked analysis and saves the report');

    await page.evaluate(async () => {
        const store = await import('/js/store.js'); await store.saveLecture({id: 'text-only-recovery', status: 'recording'});
        await store.saveChunk('text-only-recovery', 0, new Blob(['a'])); await store.completeChunk('text-only-recovery_0', {text: 'already saved'});
    });
    await page.reload(); await page.locator('[data-lecture-id="text-only-recovery"]').waitFor();
    assert.match(await page.locator('[data-lecture-id="text-only-recovery"] [role=status]').textContent(), /saved text/);
    console.log('PASS: Recovery remains visible after audio has already become saved text');
    assert.deepEqual(errors, []); console.log('PASS: No uncaught browser errors');
} finally {await browser?.close(); await new Promise(resolve => server.close(resolve));}
