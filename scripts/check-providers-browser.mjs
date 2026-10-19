// Usage: node scripts/check-providers-browser.mjs <playwright-index.mjs> [chromium-executable]
// All provider responses are fixtures. This test sends no provider traffic or user data.
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
        response.setHeader('Content-Type', ({'.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json'})[extname(path)] || 'text/html');
        response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({headless: true, executablePath: process.argv[3]});
    const context = await browser.newContext({serviceWorkers: 'block'});
    const requests = [], errors = [];
    let rejectProvider = false;
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname === '127.0.0.1') return route.continue();
        if (!['api.groq.com', 'api.openai.com'].includes(url.hostname)) return route.abort();
        requests.push({url, headers: request.headers()});
        const cors = {'access-control-allow-origin': '*'};
        if (rejectProvider) return route.fulfill({status: 401, contentType: 'application/json', headers: cors, body: JSON.stringify({error: {message: 'DO NOT EXPOSE fake-secret'}})});
        let result;
        if (url.pathname.endsWith('/audio/transcriptions')) result = {text: 'Test lecture transcript', segments: [{start: 0, end: 1, text: 'Test lecture transcript'}]};
        else {
            const data = analysisFixture(JSON.parse(request.postDataJSON().messages[1].content));
            result = {choices: [{finish_reason: 'stop', message: {content: JSON.stringify(data)}}]};
        }
        return route.fulfill({status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(result)});
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const appUrl = `http://127.0.0.1:${server.address().port}/index.html`;
    await page.goto(appUrl);
    await page.locator('#keys-drawer-btn').click();
    assert.equal(await page.locator('#notes-provider option').count(), 7);
    assert.equal(await page.locator('#transcription-provider option').count(), 5);
    await page.locator('#key-groq').fill('fake-groq-key');
    await page.locator('#key-openai').fill('fake-openai-key');
    await page.locator('#model-openai-completion').fill('account-model');
    await page.locator('#notes-provider').selectOption('openai');
    await page.locator('#save-keys-btn').click();
    await page.reload();
    await page.locator('#keys-drawer-btn').click();
    assert.equal(await page.locator('#notes-provider').inputValue(), 'openai');
    assert.equal(await page.locator('#transcription-provider').inputValue(), 'groq');
    assert.equal(await page.locator('#model-openai-completion').inputValue(), 'account-model');
    console.log('PASS: Provider choices, model IDs, and keys persist through the existing drawer');
    await page.locator('#close-drawer-btn').click();

    const workflow = await page.evaluate(async () => {
        const {createLecture, exportLibraryData} = await import('/js/lectures.js');
        const store = await import('/js/store.js');
        const {getProviderSelection} = await import('/js/providers/index.js');
        const {Queue} = await import('/js/queue.js');
        const {runPipeline} = await import('/js/pipeline.js');
        const providerSelections = {transcription: getProviderSelection('transcription'), completion: getProviderSelection('completion')};
        await createLecture({id: 'provider-test', providerSelections});
        await store.saveChunk('provider-test', 0, new Blob(['fixture'], {type: 'audio/mp3'}));
        await new Queue().processQueue('provider-test', 'en');
        const lecture = await store.getLecture('provider-test');
        const analysis = await runPipeline(lecture.transcript, () => {}, {selection: lecture.providerSelections.completion});
        return {text: lecture.transcript, summary: analysis.summary, audioRemoved: !(await store.getAllChunks(lecture.id))[0].blob,
            backupHasKey: JSON.stringify(await exportLibraryData()).includes('fake-')};
    });
    assert.deepEqual(workflow, {text: 'Test lecture transcript', summary: 'Study notes', audioRemoved: true, backupHasKey: false});
    assert.equal(requests.filter(r => r.url.hostname === 'api.groq.com').length, 1);
    assert.equal(requests.filter(r => r.url.hostname === 'api.openai.com').length, 1);
    for (const request of requests) assert.equal(request.headers.authorization,
        request.url.hostname === 'api.groq.com' ? 'Bearer fake-groq-key' : 'Bearer fake-openai-key');
    console.log('PASS: Queue uses Groq, notes use OpenAI, transcripts persist, and backups exclude keys (HTTP fixtures)');

    rejectProvider = true;
    const failure = await page.evaluate(async () => {
        const {createLecture} = await import('/js/lectures.js');
        const store = await import('/js/store.js');
        const {Queue} = await import('/js/queue.js');
        await createLecture({id: 'failed-provider'});
        await store.saveChunk('failed-provider', 0, new Blob(['fixture'], {type: 'audio/mp3'}));
        const queue = new Queue();
        let caught;
        try { await queue.processQueue('failed-provider', 'en'); } catch (error) {caught = {kind: error.kind, message: error.message};}
        return {caught, processing: queue.isProcessing, audioRetained: Boolean((await store.getAllChunks('failed-provider'))[0].blob)};
    });
    assert.equal(failure.caught.kind, 'auth'); assert.equal(failure.processing, false); assert(failure.audioRetained);
    assert(!failure.caught.message.includes('fake-secret'));
    console.log('PASS: Authentication failure stops processing, retains audio, and hides raw provider errors');

    await page.locator('#keys-drawer-btn').click();
    await page.locator('#compatible-base-url').fill('https://first.example/v1');
    await page.locator('#key-compatible').fill('fake-custom-key');
    await page.locator('#save-keys-btn').click();
    await page.locator('#keys-drawer-btn').click();
    await page.locator('#compatible-base-url').fill('https://second.example/v1');
    assert.equal(await page.locator('#key-compatible').inputValue(), '');
    console.log('PASS: Changing a custom endpoint clears the previous endpoint key');
    assert.deepEqual(errors, []);
    console.log('PASS: No uncaught browser errors');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
