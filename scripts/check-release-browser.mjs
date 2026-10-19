// Local fixtures only. No provider spending or microphone recording.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {analysisFixture} from '../tests/analysis-fixture.js';
const {chromium} = await import(pathToFileURL(process.argv[2]));
const root = resolve('dist');
let upgrade = false;
const server = createServer(async (request, response) => {
    try {
        const path = resolve(root, '.' + (new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname));
        if (!path.startsWith(root + sep)) throw new Error('Invalid path');
        response.setHeader('Content-Type', ({'.js': 'text/javascript', '.css': 'text/css'})[extname(path)] || 'text/html');
        const content = await readFile(path);
        response.setHeader('Cache-Control', 'no-store');
        response.end(upgrade && path.endsWith('sw.js') ? content.toString().replace(/delectured-v3-[a-f0-9]{16}/g, 'delectured-v3-upgrade-fixture') : content);
    } catch {response.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
    browser = await chromium.launch({headless: true, executablePath: process.argv[3]});
    const context = await browser.newContext(), errors = [];
    await context.route('https://fonts.**/*', route => route.abort());
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url + '/index.html');
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        const store = await import('./js/store.js');
        await store.saveLecture({id:'saved-test', title:'Saved fixture', status:'ready', durationMs:65000,
            transcript:'Vector addition uses components. Hindi explanation.', analysis:{summary:'Saved summary', flashcards:[{q:'Vector?',a:'Components'}]}});
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.goto(url + '/index.html?lecture=saved-test');
    await page.waitForFunction(() => document.getElementById('lecture-title').value === 'Saved fixture');
    assert.equal(await page.locator('#lecture-duration').textContent(), '1:05');
    assert.match(await page.locator('#summary-content').textContent(), /Saved summary/);
    console.log('PASS: Built release installs and reopens a saved report offline with query parameters');
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export-md').click();
    const download = await downloadPromise; assert.equal(download.suggestedFilename(), 'lecture.md');
    assert.match(await readFile(await download.path(), 'utf8'), /Vector addition/);
    const csvPromise = page.waitForEvent('download'); await page.locator('#export-csv').click();
    assert.match(await readFile(await (await csvPromise).path(), 'utf8'), /Components/);
    await page.emulateMedia({media:'print'}); assert.equal(await page.locator('#lecture-question-form').isVisible(), false);
    const pdf = await page.pdf(); assert(pdf.length > 1000); await page.emulateMedia({media:'screen'});
    console.log('PASS: Markdown and CSV downloads retain content; native PDF has printable report content');
    page.once('dialog', dialog => dialog.accept('Renamed fixture')); await page.locator('#rename-report').click();
    await page.waitForFunction(() => document.getElementById('lecture-title').value === 'Renamed fixture');
    await page.goto(url + '/library.html'); await page.locator('#library-search').fill('components');
    await page.waitForFunction(() => document.querySelector('#library-list').textContent.includes('Renamed fixture'));
    await page.locator('.view-link').click(); await page.waitForFunction(() => document.getElementById('lecture-title').value === 'Renamed fixture');
    console.log('PASS: Offline rename, search and Library View persist and reopen');
    await context.setOffline(false);
    await page.evaluate(async () => (await import('./js/config.js')).saveConfig({keys:{groq:'fixture-only'}}));
    await context.route('**/chat/completions', route => route.fulfill({status:200, contentType:'application/json', body: JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answerable:true,answer:'Use components.',references:[{id:'p0',quote:'Vector addition uses components.'}]})}}]})}));
    await page.locator('#lecture-question').fill('Vector addition?'); await page.locator('#lecture-question-form button[type=submit]').click();
    await page.waitForFunction(() => document.getElementById('lecture-answer').textContent.includes('Use components.'));
    assert.match(await page.locator('#lecture-answer').textContent(), /Vector addition uses components/);
    await context.unroute('**/chat/completions');
    let regenerationCalls = 0;
    await context.route('**/chat/completions', route => {
        regenerationCalls++;
        const payload = JSON.parse(route.request().postDataJSON().messages[1].content);
        return route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysisFixture(payload, 'Regenerated notes'))}}]})});
    });
    await page.locator('#regenerate-report').click();
    await page.waitForFunction(() => document.querySelector('#result-section').classList.contains('active-view') && document.querySelector('#summary-content').textContent.includes('Regenerated notes'));
    assert.equal(regenerationCalls, 1);
    assert.equal(await page.locator('#lecture-title').inputValue(), 'Renamed fixture');
    console.log('PASS: Saved transcript regenerates using current notes settings without retranscription');
    const cacheURLs = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(r => r.url)))).flat());
    assert(cacheURLs.every(u => u.startsWith(url) && !u.includes('?') && !u.includes('completions')));
    console.log('PASS: Q&A renders validated fixture evidence and caches contain only public local assets');
    upgrade = true;
    await page.evaluate(async () => {const reg = await navigator.serviceWorker.getRegistration(); await reg.update();});
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    await page.close();
    const updated = await context.newPage(); await updated.goto(url + '/index.html?lecture=saved-test');
    await updated.waitForFunction(async () => (await caches.keys()).includes('delectured-v3-upgrade-fixture') && (await caches.keys()).filter(n => n.startsWith('delectured-v3-')).length === 1);
    await context.setOffline(true); await updated.reload();
    await updated.waitForFunction(() => document.getElementById('lecture-title').value === 'Renamed fixture');
    console.log('PASS: Waiting service-worker upgrade activates after closing old clients, removes old caches and preserves Library offline');
    assert.deepEqual(errors, []); console.log('PASS: No uncaught browser errors');
} finally {await browser?.close(); await new Promise(resolve => server.close(resolve));}
