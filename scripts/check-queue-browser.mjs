// Local fixtures only. No provider spending or microphone recording.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium} = await import(pathToFileURL(process.argv[2]));
const root = resolve('.');
const server = createServer(async (request, response) => {
    try {
        const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
        if (!path.startsWith(root + sep)) throw new Error('Invalid path');
        response.setHeader('Content-Type', ({'.js': 'text/javascript', '.css': 'text/css'})[extname(path)] || 'text/html');
        response.end(await readFile(path));
    } catch {response.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({headless: true, executablePath: process.argv[3]});
    const context = await browser.newContext({serviceWorkers: 'block', acceptDownloads: true});
    await context.route('**/*', route => {
        if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
        if (route.request().url().includes('/audio/transcriptions')) return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({text: 'fixture transcript', segments: []})});
        return route.abort();
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await context.newPage(), other = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); other.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/tests/browser/queue.html'); await other.goto(base + '/tests/browser/queue.html');
    await page.evaluate(async () => {
        const store = await import('/js/store.js'); const {Queue} = await import('/js/queue.js');
        await store.saveLecture({id: 'cross-tab'}); await store.saveChunk('cross-tab', 0, new Blob(['audio']));
        window.calls = 0; window.started = false;
        const gate = new Promise(resolve => {window.release = resolve;});
        window.queue = new Queue({transcribe: async () => {window.calls++; window.started = true; await gate; return {text: 'single completion'};}});
        window.work = queue.drain('cross-tab');
    });
    await page.waitForFunction(() => window.started);
    await other.evaluate(async () => {
        const {Queue} = await import('/js/queue.js'); window.calls = 0;
        window.work = new Queue({transcribe: async () => {window.calls++; return {text: 'duplicate'};}}).resume('cross-tab');
    });
    await page.evaluate(() => window.release());
    await Promise.all([page.evaluate(() => window.work), other.evaluate(() => window.work)]);
    assert.equal(await page.evaluate(() => window.calls), 1); assert.equal(await other.evaluate(() => window.calls), 0);
    console.log('PASS: Two tabs serialize transcription and do not duplicate completion');

    await page.evaluate(async () => {
        const store = await import('/js/store.js'); const {Queue} = await import('/js/queue.js');
        const {initQueueControls} = await import('/js/queue-controls.js');
        await store.saveLecture({id: 'offline', title: 'Offline fixture'}); await store.saveChunk('offline', 0, new Blob(['export audio'], {type: 'audio/mp3'}));
        window.offlineQueue = new Queue({online: () => false});
        await initQueueControls(offlineQueue).refresh();
    });
    const row = page.locator('[data-lecture-id="offline"]');
    await row.getByRole('button', {name: 'Resume saved work'}).click();
    await page.waitForFunction(() => document.querySelector('[data-lecture-id="offline"] [role=status]').textContent.includes('Offline.'));
    assert.equal(await row.getByRole('button', {name: 'Export retained audio'}).isEnabled(), true);
    await row.getByRole('button', {name: 'Export retained audio'}).click();
    const downloadPromise = page.waitForEvent('download'); await row.getByRole('link', {name: 'Save audio part 1'}).click();
    const download = await downloadPromise; assert.equal(await download.failure(), null); assert.equal(download.suggestedFilename(), 'recording-part-1.mp3');
    assert.equal(await page.evaluate(async () => (await offlineQueue.getRetainedAudio('offline')).length), 1);
    page.once('dialog', dialog => dialog.accept()); await row.getByRole('button', {name: 'Discard recording'}).click();
    await page.waitForFunction(() => !document.querySelector('[data-lecture-id="offline"]'));
    assert.equal(await page.evaluate(async () => (await import('/js/store.js')).getLecture('offline')), undefined);
    console.log('PASS: Offline recovery keeps export/discard available; download retains audio, discard deletes it');

    await page.reload();
    await page.evaluate(async () => {
        const store = await import('/js/store.js'); const {Queue} = await import('/js/queue.js');
        const {initQueueControls} = await import('/js/queue-controls.js');
        await store.saveLecture({id: 'full'}); window.full = true; window.calls = 0;
        window.fullQueue = new Queue({store: {...store, putChunk: (...args) => window.full ? Promise.reject(new DOMException('full', 'QuotaExceededError')) : store.putChunk(...args)},
            transcribe: async () => {window.calls++; return {text: 'saved after freeing space'};}});
        initQueueControls(fullQueue);
        await fullQueue.enqueue({lectureId: 'full', index: 0, blob: new Blob(['RAM audio'], {type: 'audio/mp3'})}).catch(() => {});
    });
    const fullRow = page.locator('[data-lecture-id="full"]');
    assert.match(await fullRow.locator('[role=status]').textContent(), /lost on reload/);
    assert.equal(await page.evaluate(() => window.calls), 0);
    await fullRow.getByRole('button', {name: 'Export retained audio'}).click();
    await fullRow.getByRole('link', {name: 'Save audio part 1'}).waitFor();
    assert.equal(await fullRow.getByRole('link', {name: 'Save audio part 1'}).count(), 1);
    await page.evaluate(() => {window.full = false;});
    await fullRow.getByRole('button', {name: 'Retry after fixing the problem'}).click();
    await page.waitForFunction(() => document.querySelector('[data-lecture-id="full"] [role=status]').textContent.includes('Transcription saved'));
    assert.equal(await page.evaluate(() => fullQueue.hasUnsavedAudio()), false);
    assert.equal(await page.evaluate(async () => (await import('/js/store.js')).getLecture('full').then(l => l.transcript)), 'saved after freeing space');
    console.log('PASS: Storage-full audio stays in RAM, is exportable, and saves after retry');

    await page.evaluate(async () => {
        const store = await import('/js/store.js');
        await store.saveLecture({id: 'reload'}); await store.putChunk({lectureId: 'reload', index: 0, blob: new Blob(['audio']), status: 'processing', attempts: 2});
    });
    await page.reload();
    const recovered = await page.evaluate(async () => {
        const store = await import('/js/store.js'); const {Queue} = await import('/js/queue.js');
        await new Queue({transcribe: async () => ({text: 'after reload'})}).resume('reload');
        const [chunk] = await store.getAllChunks('reload'); return {text: chunk.text, attempts: chunk.attempts, audio: !!chunk.blob};
    });
    assert.deepEqual(recovered, {text: 'after reload', attempts: 3, audio: false});
    console.log('PASS: Reload recovers processing state without resetting attempts and releases audio after commit');

    await page.goto(base + '/index.html?capture=1');
    await page.evaluate(async () => {
        const {saveConfig} = await import('/js/config.js'); saveConfig({keys: {groq: 'fixture-key'}});
        const {Recorder} = await import('/js/recorder.js');
        Recorder.prototype.start = async function () {this.isRecording = true; window.capturedRecorder = this;};
        Recorder.prototype.stop = async function () {this.isRecording = false; window.captureStopped = true;};
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
            if (this.name === 'lectures' && value.transcript === 'fixture transcript') throw new DOMException('full', 'QuotaExceededError');
            return put.call(this, value, ...args);
        };
    });
    await page.locator('#start-record-btn').click();
    await page.waitForFunction(() => window.capturedRecorder);
    await page.evaluate(() => capturedRecorder.onChunkReady({index: 0, startMs: 0, durationMs: 1000, overlapMs: 0, blob: new Blob(['fixture'], {type: 'audio/mp3'})}));
    await page.waitForFunction(() => window.captureStopped);
    assert.match(await page.locator('#recording-caption').textContent(), /could not be saved/);
    assert.equal(await page.evaluate(async () => {
        const store = await import('/js/store.js'); const lecture = (await store.getAllLectures()).find(l => l.title === 'Lecture Analysis');
        return !!(await store.getAllChunks(lecture.id))[0].blob;
    }), true);
    console.log('PASS: A transcript commit failure stops capture and retains durable audio (recorder fixture)');
    assert.deepEqual(errors, []); console.log('PASS: No uncaught browser errors');
} finally {await browser?.close(); await new Promise(resolve => server.close(resolve));}
