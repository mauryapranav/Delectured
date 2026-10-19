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
    const context = await browser.newContext({serviceWorkers: 'block'}), requests = [], errors = [];
    let fail = true;
    await context.route('**/*', route => {
        const req = route.request(); if (new URL(req.url()).hostname === '127.0.0.1') return route.continue();
        if (!req.url().endsWith('/chat/completions')) return route.abort();
        const payload = JSON.parse(req.postDataJSON().messages[1].content); requests.push(payload);
        if (fail && requests.length === 2) return route.fulfill({status: 401, contentType: 'application/json', body: '{"error":{"message":"fixture auth"}}'});
        const packet = analysisFixture(payload, `Notes ${payload.source?.text.slice(-80) ?? ''}`);
        return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(packet)}}]})});
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}/index.html`;
    await page.goto(url);
    await page.evaluate(async () => {
        const store = await import('/js/store.js'), {saveConfig} = await import('/js/config.js'); saveConfig({keys: {groq: 'fixture-key'}});
        await store.saveLecture({id: 'analysis-resume', title: 'Long fixture', status: 'interrupted', language: 'hi-en'});
        const text = 'Repeated explanation with code x += 1; हिंदी. '.repeat(170) + ' FINAL_DETAIL';
        await store.putChunk({lectureId: 'analysis-resume', index: 0, startMs: 0, durationMs: 300000, blob: new Blob(['already processed'])});
        await store.completeChunk('analysis-resume_0', {text, segments: [{start: 0, end: 300, text}]});
    });
    await page.reload();
    await page.locator('[data-lecture-id="analysis-resume"]').getByRole('button', {name: 'Resume saved work'}).click();
    await page.waitForFunction(async () => (await (await import('/js/store.js')).getLecture('analysis-resume')).analysisCheckpoint?.maps.length === 1);
    await page.waitForFunction(() => document.querySelector('[data-lecture-id="analysis-resume"] [role=status]').textContent.includes('API key'));
    assert.equal(requests.length, 2);
    assert.equal(await page.evaluate(async () => (await (await import('/js/store.js')).getLecture('analysis-resume')).analysisStatus), 'partial');
    console.log('PASS: Analysis failure preserves the transcript, validated section and checkpoint in real IndexedDB');
    fail = false; const previous = requests.length;
    await page.reload();
    await page.locator('[data-lecture-id="analysis-resume"]').getByRole('button', {name: 'Resume saved work'}).click();
    await page.waitForFunction(() => document.getElementById('result-section').classList.contains('active-view'));
    assert(!requests.slice(previous).some(r => r.source?.id === 'w0'));
    const saved = await page.evaluate(async () => {
        const store = await import('/js/store.js'), {exportLibraryData} = await import('/js/lectures.js'); const lecture = await store.getLecture('analysis-resume');
        return {sections: lecture.analysis.sections.length, last: lecture.analysis.sections.at(-1).notes, state: lecture.analysisStatus,
            backupHasKey: JSON.stringify(await exportLibraryData()).includes('fixture-key'), scores: lecture.analysis.scores};
    });
    assert(saved.sections > 1); assert(saved.last.includes('FINAL_DETAIL')); assert.equal(saved.state, 'ready'); assert.equal(saved.backupHasKey, false); assert.deepEqual(saved.scores, {});
    console.log('PASS: Reload resumes remaining analysis without repeating the first extraction; final detail survives and backups exclude credentials');
    assert.equal(await page.locator('#score-clarity').textContent(), '--');
    assert.match(await page.locator('#summary-content').textContent(), /FINAL_DETAIL/);
    assert.match(await page.locator('#exam-signals-list').textContent(), /No explicit exam cues/);
    console.log('PASS: Existing report renders detailed sections and evidence, omits invented scores, and distinguishes absent exam cues');
    assert.deepEqual(errors, []); console.log('PASS: No uncaught browser errors');
} finally {await browser?.close(); await new Promise(resolve => server.close(resolve));}
