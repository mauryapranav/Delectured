// Run after npm run build. Arguments: Playwright module path, Chromium/Edge executable.
// Isolated browser profile, synthetic transcript, fake key, intercepted provider traffic.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep, join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium} = await import(pathToFileURL(process.argv[2]));
const root = resolve('dist');
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/Delectured/')) throw Error();
        const file = resolve(root, '.' + url.pathname.slice('/Delectured'.length).replace(/\/$/, '/index.html'));
        if (!file.startsWith(root + sep)) throw Error();
        res.setHeader('Content-Type', ({'.js':'text/javascript', '.css':'text/css', '.webmanifest':'application/manifest+json'})[extname(file)] || 'text/html');
        res.end(await readFile(file));
    } catch {res.writeHead(404).end();}
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/Delectured/`;
const transcript = 'Python uses indentation to define blocks. Functions use the def keyword. Variables refer to values. '.repeat(70);
const packet = source => {
    const evidence = [{sourceId: source.id, quote: source.text.trim().slice(0, 60)}];
    return {notes: '## Python blocks\nPython uses indentation.\n\n```python\ndef hello():\n    return 1\n```', evidence,
        topics: ['Python'], concepts: [{term:'Python', definition:'A programming language.', evidence}, {term:'Indentation', definition:'Defines blocks.', evidence}],
        flashcards:[{q:'How are Python blocks defined?', a:'Using indentation.', evidence}], examSignals:[],
        links:[{from:'Python', to:'Indentation', relation:'uses', evidence}]};
};
let browser;
try {
    browser = await chromium.launch({headless:true, executablePath:process.argv[3]});
    const context = await browser.newContext({serviceWorkers:'block', viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
    const page = await context.newPage(), errors = [], requests = [], missing = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => {if (r.url().startsWith(base) && r.status() >= 400) missing.push(r.url());});
    page.on('dialog', d => d.dismiss());
    let mode = 'success', failWindow = false;
    await context.route('**/*', async route => {
        const req = route.request();
        if (req.url().startsWith(base)) return route.continue();
        if (req.url() !== 'https://api.groq.com/openai/v1/chat/completions') return route.abort();
        const body = req.postDataJSON();
        assert.equal(body.response_format?.type, 'json_object');
        const payload = JSON.parse(body.messages[1].content);
        requests.push({model:body.model, payload});
        const reply = (status, data, headers = {}) => route.fulfill({status, contentType:'application/json', headers, body:JSON.stringify(data)});
        if (mode === 'network') return route.abort();
        if (mode === 'envelope') return route.fulfill({status:200, contentType:'text/html', body:'private-api-html'});
        if (/^http/.test(mode)) return reply(Number(mode.slice(4)), {error:{message:'private-provider-body'}}, {'retry-after':'1'});
        if (failWindow && payload.source?.id === 'w1') return reply(429, {error:{}}, {'retry-after':'1'});
        let content;
        if (payload.question) {
            content = mode === 'bad-answer' ? '{private-answer' : JSON.stringify({answerable:true, answer:'Python uses indentation.', references:[{id:payload.passages[0].id, quote:'Python uses indentation'}]});
        } else {
            const result = payload.stage === 'extract' ? packet(payload.source) : {summary:'Python uses indentation and functions.'};
            if (mode === 'evidence' && result.evidence) result.evidence[0].quote = 'invented unsupported quote';
            if (mode === 'schema') result.topics = 'invalid list';
            if (mode === 'graph') result.links[0].to = 'Unknown concept';
            content = mode === 'malformed' ? '{private-json' : mode === 'oversize' ? JSON.stringify({notes:'x'.repeat(6000)}) : JSON.stringify(result);
        }
        return reply(200, {choices:[{finish_reason:mode === 'truncated' ? 'length' : 'stop', message:{content:mode === 'empty' ? '' : content}}]});
    });
    async function ready() {await page.waitForFunction(() => document.documentElement.dataset.routerReady === 'true');}
    async function seed(id, text = transcript, legacy = false) {
        await page.evaluate(async ({id,text,legacy}) => {
            const store = await import('./js/store.js'), {saveConfig} = await import('./js/config.js');
            saveConfig({keys:{groq:'fixture-key'}, models:{groq:{completion:'openai/gpt-oss-120b'}}});
            const selection = {providerId:'groq', model:'whisper-large-v3-turbo', baseUrl:'https://api.groq.com/openai/v1'};
            await store.saveLecture({id, title:`Test ${id}`, transcript:text, status:'failed', analysisStatus:'failed',
                ...(legacy ? {} : {providerSelections:{transcription:selection,completion:{...selection,model:'retired-model'}}})});
        }, {id,text,legacy});
        await page.reload(); await ready();
    }
    async function retry(id, name = 'Retry after fixing the problem') {
        await page.locator(`[data-lecture-id="${id}"]`).getByRole('button', {name, exact:true}).click();
    }
    await page.goto(base); await ready();
    for (const [scenario, message] of [['http400','HTTP 400'],['http401','HTTP 401'],['http403','HTTP 403'],['http404','HTTP 404'],['http413','HTTP 413'],['http429','HTTP 429'],['http500','HTTP 500'],['network','Could not reach'],['envelope','unreadable API response'],['malformed','invalid JSON'],['schema','Invalid list field'],['graph','unknown concept'],['evidence','Evidence does not occur'],['oversize','byte budget'],['truncated','stopped before completing'],['empty','empty notes response']]) {
        mode = scenario; await seed(scenario, 'Python uses indentation to define blocks.');
        const start = requests.length; await retry(scenario);
        await page.waitForFunction(({id,message}) => document.querySelector(`[data-lecture-id="${id}"] [role=status]`)?.textContent.includes(message), {id:scenario,message});
        assert.equal(requests.length-start, scenario.startsWith('http') && scenario !== 'http400' || scenario === 'network' ? 1 : 2);
        const saved = await page.evaluate(async id => (await import('./js/store.js')).getLecture(id), scenario);
        assert.equal(saved.transcript, 'Python uses indentation to define blocks.');
        assert.equal(saved.analysisStatus, 'failed');
        assert(!(await page.locator('#recording-caption').textContent()).includes('Repairing'));
        assert(!(await page.locator('body').textContent()).includes('private-'));
        console.log(`PASS ${scenario}: safe error, bounded requests, transcript retained`);
    }
    mode='success'; failWindow=true; await seed('final', transcript, true); await retry('final');
    await page.waitForFunction(() => document.querySelector('[data-lecture-id="final"] [role=status]')?.textContent.includes('HTTP 429'));
    let saved = await page.evaluate(async () => (await import('./js/store.js')).getLecture('final'));
    assert.equal(saved.analysisCheckpoint.maps.length,1);
    failWindow=false; const start=requests.length;
    await page.reload(); await ready(); await retry('final');
    await page.locator('#result-section.active-view').waitFor();
    assert(!requests.slice(start).some(r => r.payload.source?.id === 'w0'));
    assert(requests.slice(start).every(r => r.model === 'openai/gpt-oss-120b'));
    assert.match(await page.locator('#summary-content').textContent(), /Python uses indentation/);
    assert(await page.locator('#summary-content pre').count() > 0);
    await page.locator('#tab-connections').click();
    assert.equal(await page.locator('#concept-graph [role=button]').count(), 2);
    await page.locator('#concept-graph [role=button]').last().click();
    assert.match(await page.locator('#concept-detail').textContent(), /Indentation/);
    await page.locator('#tab-recall').click();
    await page.locator('#flashcards-content summary').first().click();
    assert.match(await page.locator('#flashcards-content details[open]').first().textContent(), /Using indentation/);
    await page.locator('#tab-transcript').click();
    assert.equal(await page.locator('#transcript-content').textContent(), transcript);
    await page.locator('#tab-notes').click();
    await page.locator('#lecture-question').fill('How does Python define blocks?');
    await page.locator('#lecture-question-form button[type=submit]').click();
    await page.waitForFunction(() => document.getElementById('lecture-answer').textContent.includes('p0:'));
    mode='bad-answer'; await page.locator('#lecture-question-form button[type=submit]').click();
    await page.waitForFunction(() => document.getElementById('lecture-answer').textContent.includes('JSON'));
    assert(!(await page.locator('#lecture-answer').textContent()).includes('private-answer'));
    mode='success';
    for (const type of ['export-md','export-csv']) {
        await page.locator('#export-menu summary').click();
        const download = page.waitForEvent('download');
        await page.locator(`[data-export="${type}"]`).click();
        assert.equal((await download).suggestedFilename(), type === 'export-md' ? 'lecture.md' : 'flashcards.csv');
    }
    await page.locator('.back-library').click(); await page.locator('#library-section.active-view').waitFor();
    await page.locator('[data-id="final"][data-action="view"]').click(); await page.locator('#result-section.active-view').waitFor();
    await page.reload(); await ready(); assert.match(await page.locator('#lecture-heading').textContent(), /Test final/);
    await page.setViewportSize({width:390,height:844});
    await page.locator('#tab-connections').click();
    assert.equal(await page.locator('#concept-graph svg').count(),1);
    await page.locator('#tab-notes').click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const screenshot=join(tmpdir(),'delectured-notes-release.png'); await page.screenshot({path:screenshot,fullPage:true});
    console.log(`PASS final panel: notes/code, graph, recall, transcript, Q&A, exports, Library, reload, mobile; screenshot ${screenshot}`);
    saved = await page.evaluate(async () => (await import('./js/store.js')).getLecture('final'));
    assert.equal(saved.status,'ready'); assert.equal(saved.analysisStatus,'ready');
    assert.deepEqual(errors,[]); assert.deepEqual(missing,[]);
    await context.close();
    const offline = await browser.newContext({serviceWorkers:'allow'});
    const offlinePage=await offline.newPage();
    await offlinePage.goto(base); await offlinePage.waitForFunction(() => document.documentElement.dataset.routerReady==='true');
    await offlinePage.evaluate(async lecture => {await (await import('./js/store.js')).saveLecture(lecture); await navigator.serviceWorker.ready;}, saved);
    await offlinePage.reload(); await offlinePage.waitForFunction(() => !!navigator.serviceWorker.controller);
    await offline.setOffline(true);
    await offlinePage.goto(base+'index.html?lecture=final');
    await offlinePage.locator('#result-section.active-view').waitFor();
    assert.match(await offlinePage.locator('#summary-content').textContent(), /Python uses indentation/);
    console.log('PASS offline: cached shell, imported modules and saved final report reopen');
    await offline.close();
} finally {await browser?.close(); await new Promise(r=>server.close(r));}
