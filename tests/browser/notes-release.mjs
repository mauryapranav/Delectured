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
    browser = await chromium.launch({headless:true, executablePath:process.argv[3],args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
    const context = await browser.newContext({serviceWorkers:'block', viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
    const page = await context.newPage(), errors = [], requests = [], missing = [], dialogs=[];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => {if (r.url().startsWith(base) && r.status() >= 400) missing.push(r.url());});
    page.on('dialog', d => {dialogs.push(d.message());console.log(`Unexpected browser dialog: ${d.type()}`);return d.dismiss();});
    let mode = 'success', failWindow = false, held=[], audioCalls=0, audioFailure=false;
    await context.route('**/*', async route => {
        const req = route.request();
        if (req.url().startsWith(base)) return route.continue();
        if(req.url()==='https://api.groq.com/openai/v1/audio/transcriptions') {
            audioCalls++;
            return route.fulfill({status:audioFailure&&audioCalls>1?401:200,contentType:'application/json',body:JSON.stringify(audioFailure&&audioCalls>1?{error:{}}:{text:'Python uses indentation to define blocks.',segments:[]})});
        }
        if (!['https://api.groq.com/openai/v1/chat/completions','https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'].includes(req.url())) return route.abort();
        const body = req.postDataJSON();
        if(mode==='numbered-repair') {
            assert.equal(req.url(),'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
            assert.equal(body.model,'gemini-3.5-flash-lite');
            assert.equal(req.headers().authorization,'Bearer gemini-fixture');
        }
        const payload = JSON.parse(body.messages[1].content);
        assert.equal(body.response_format?.type, payload.question || mode==='numbered-repair' ? 'json_object' : 'json_schema');
        if(body.response_format.type==='json_schema')assert.equal(body.response_format.json_schema.strict,true);
        requests.push({model:body.model, payload});
        if(mode==='hold'){held.push(route);return;}
        const reply = (status, data, headers = {}) => route.fulfill({status, contentType:'application/json', headers:{'access-control-expose-headers':'retry-after',...headers}, body:JSON.stringify(data)});
        if (mode === 'network') return route.abort();
        if (mode === 'envelope') return route.fulfill({status:200, contentType:'text/html', body:'private-api-html'});
        if (/^http/.test(mode)) return reply(Number(mode.slice(4)), {error:{message:'private-provider-body'}}, {'retry-after':'61'});
        if (failWindow && payload.source?.id === 'w1') return reply(429, {error:{}}, {'retry-after':'1'});
        let content;
        if (payload.question) {
            content = mode === 'bad-answer' ? '{private-answer' : JSON.stringify({answerable:true, answer:'Python uses indentation.', references:[{id:payload.passages[0].id, quote:'Python uses indentation'}]});
        } else {
            const result = payload.stage === 'extract' ? packet({...payload.source,text:payload.source.text ?? payload.excerpts.map(e=>e.quote).join('')}) : {summary:'Python uses indentation and functions.'};
            if (mode === 'numbered-repair' && result.evidence) {
                assert(payload.excerpts);
                if (!body.messages[0].content.includes('previous output failed validation')) result.evidence[0].quote = 'A paraphrase absent from the recording';
                else {
                    const refs=[{excerptId:payload.excerpts[0].id}];
                    result.evidence=refs;
                    for(const key of ['concepts','flashcards','examSignals','links'])for(const item of result[key])item.evidence=refs;
                    assert.equal(body.response_format.type,'json_object');
                    assert(body.messages[0].content.includes('excerptId'));
                }
            }
            if (mode === 'evidence' && result.evidence) result.evidence[0].quote = 'invented unsupported quote';
            if (mode === 'schema') result.topics = 'invalid list';
            if (mode === 'long-field') result.notes = 'x'.repeat(2200);
            if (mode === 'graph') result.links[0].to = 'Unknown concept';
            content = mode === 'malformed' ? '{private-json' : mode === 'oversize' ? JSON.stringify({notes:'x'.repeat(25000)}) : JSON.stringify(result);
        }
        return reply(200, {choices:[{finish_reason:mode === 'truncated' ? 'length' : 'stop', message:{content:mode === 'empty' ? '' : content}}]});
    });
    async function ready() {await page.waitForFunction(() => document.documentElement.dataset.routerReady === 'true');}
    async function seed(id, text = transcript, legacy = false, gemini = false) {
        await page.evaluate(async ({id,text,legacy,gemini}) => {
            const store = await import('./js/store.js'), {saveConfig} = await import('./js/config.js');
            saveConfig({notesProvider:gemini?'gemini':'groq',keys:{groq:'fixture-key',gemini:'gemini-fixture'}, models:{groq:{completion:'openai/gpt-oss-120b'},gemini:{completion:'gemini-3.5-flash-lite'}}});
            const selection = {providerId:'groq', model:'whisper-large-v3-turbo', baseUrl:'https://api.groq.com/openai/v1'};
            await store.saveLecture({id, title:`Test ${id}`, transcript:text, status:'failed', analysisStatus:'failed',
                ...(legacy ? {} : {providerSelections:{transcription:selection,completion:{...selection,model:'retired-model'}}})});
        }, {id,text,legacy,gemini});
        await page.reload(); await ready();
    }
    async function retry(id, name = 'Retry after fixing the problem') {
        await page.locator(`[data-lecture-id="${id}"]`).getByRole('button', {name, exact:true}).click();
    }
    await page.goto(base); await ready();
    mode='numbered-repair';await seed('numbered-repair', 'Python uses indentation to define blocks. Functions use the def keyword. Variables refer to values. '.repeat(1100),false,true);
    await retry('numbered-repair');await page.locator('#result-section.active-view').waitFor({timeout:60000});
    const repaired=await page.evaluate(async()=> (await import('./js/store.js')).getLecture('numbered-repair'));
    assert.equal(repaired.analysis.sections.length,22);
    assert(repaired.analysis.sections.every(section=>section.evidence.every(ref=>ref.quote && !ref.excerptId)));
    assert.equal(repaired.status,'ready');
    console.log('PASS 22-section notes: every quote failure repaired with numbered excerpts, final report saved');
    for (const optionalMode of ['schema','graph']) {
        mode=optionalMode;await seed(`optional-${mode}`,'Python uses indentation to define blocks.');
        await retry(`optional-${mode}`);await page.locator('#result-section.active-view').waitFor({timeout:30000});
        const saved=await page.evaluate(async id=>(await import('./js/store.js')).getLecture(id),`optional-${mode}`);
        assert.equal(saved.status,'ready');assert(saved.analysis.warnings.some(w=>w.includes('omitted optional')));
        console.log(`PASS optional ${mode}: validated notes saved with visible omission warning`);
    }
    for (const [scenario, message] of [['http400','HTTP 400'],['http401','HTTP 401'],['http403','HTTP 403'],['http404','HTTP 404'],['http413','HTTP 413'],['http429','HTTP 429'],['http500','HTTP 500'],['network','Could not reach'],['envelope','unreadable API response'],['malformed','invalid JSON'],['long-field','2200 characters'],['evidence','Evidence does not occur'],['oversize','byte budget'],['truncated','stopped before completing'],['empty','empty notes response']]) {
        mode = scenario; await seed(scenario, 'Python uses indentation to define blocks.');
        const start = requests.length; await retry(scenario);
        await page.waitForFunction(({id,message}) => document.querySelector(`[data-lecture-id="${id}"] [role=status]`)?.textContent.includes(message), {id:scenario,message});
        assert.equal(requests.length-start, scenario==='network'?3:scenario.startsWith('http')?1:2);
        const saved = await page.evaluate(async id => (await import('./js/store.js')).getLecture(id), scenario);
        assert.equal(saved.transcript, 'Python uses indentation to define blocks.');
        assert.equal(saved.analysisStatus, 'failed');
        assert.equal(saved.processingIssue.stage,'notes');
        assert.equal(await page.locator('[data-step="transcribe"]').getAttribute('data-state'),'complete');
        assert.equal(await page.locator('[data-step="notes"]').getAttribute('data-state'),'failed');
        assert.equal(await page.locator('#stop-record-btn').isVisible(),false);
        assert.equal(await page.locator('#discard-record-btn').isVisible(),false);
        assert.equal(await page.locator('#processing-problem').isVisible(),true);
        assert.match(await page.locator('#processing-preserved').textContent(),/transcript is saved/);
        if(scenario==='http429') {
            assert(await page.locator('#processing-retry').isDisabled());
            assert.match(await page.locator('#processing-wait').textContent(),/seconds/);
        }
        if(scenario==='long-field') {
            assert.match(await page.locator('#processing-reason').textContent(),/2200 characters.*2000/);
            assert.match(await page.locator('#processing-diagnostic').textContent(),/2200 characters/);
        }
        if(scenario==='evidence') {
            await page.locator('#processing-settings').click();
            assert(await page.locator('#keys-drawer.open').isVisible()); await page.keyboard.press('Escape');
            const exported=page.waitForEvent('download'); await page.locator('#processing-export').click();
            assert.equal((await exported).suggestedFilename(),'transcript.txt');
            await page.locator('#processing-flow').screenshot({path:join(tmpdir(),'delectured-processing-desktop.png')});
            await page.setViewportSize({width:390,height:844});
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            await page.locator('#processing-flow').screenshot({path:join(tmpdir(),'delectured-processing-mobile.png')});
            await page.setViewportSize({width:1440,height:1000});
            await page.reload(); await ready();
            assert.match(await page.locator(`[data-lecture-id="${scenario}"] [role=status]`).textContent(),/Notes stopped at section 1 of 1/);
            assert.match(await page.locator(`[data-lecture-id="${scenario}"] [role=status]`).textContent(),/AI supplied a quote/);
        }
        assert(!(await page.locator('#recording-caption').textContent()).includes('Repairing'));
        assert(!(await page.locator('body').textContent()).includes('private-'));
        console.log(`PASS ${scenario}: safe error, bounded requests, transcript retained`);
    }
    mode='hold'; await seed('pause','Python uses indentation.');
    const pending=page.waitForRequest(r=>r.url().endsWith('/chat/completions'));
    await retry('pause'); await pending;
    assert(await page.locator('[data-lecture-id="pause"]').getByRole('button',{name:'Retry after fixing the problem',exact:true}).isDisabled());
    await page.locator('#processing-cancel').click();
    await page.waitForFunction(()=>document.querySelector('#processing-problem-title').textContent.includes('paused'));
    assert.match(await page.locator('#processing-preserved').textContent(),/transcript is saved/);
    for(const route of held)await route.abort().catch(()=>{}); held=[];
    await page.locator('[data-lecture-id="pause"]').getByRole('button',{name:'Retry after fixing the problem',exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('[data-lecture-id="pause"] button').disabled);
    console.log('PASS progress UI: inline errors, completed transcription step, settings, transcript export, persisted failure, mobile layout, pause and operation lock');
    // Fresh upload must handle a cancelled notes request, not only recovered lectures.
    await page.goto(base+'index.html?capture=1'); await ready();
    const wav=Buffer.alloc(44+32000); wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(16000,24);
    wav.writeUInt32LE(32000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(32000,40);
    mode='hold'; const uploadNotes=page.waitForRequest(r=>r.url().endsWith('/chat/completions'));
    await page.locator('#file-input').setInputFiles({name:'fresh.wav',mimeType:'audio/wav',buffer:wav});
    await page.getByRole('button',{name:'Start processing',exact:true}).click(); await uploadNotes;
    await page.locator('#processing-cancel').click();
    await page.waitForFunction(()=>document.querySelector('#processing-problem-title').textContent.includes('paused'));
    for(const route of held)await route.abort().catch(()=>{});held=[];
    await page.waitForFunction(()=>[...document.querySelectorAll('#queue-recovery button')].filter(b=>b.textContent==='Resume saved work').every(b=>!b.disabled || b.closest('[data-lecture-id]').dataset.lectureId==='http429'));
    // Real recorder with short test-only chunk boundaries; microphone remains fake.
    await page.goto(base+'index.html?capture=1'); await ready();
    const beforeDuplicate=requests.length;
    await page.locator('#file-input').setInputFiles({name:'fresh.wav',mimeType:'audio/wav',buffer:wav});
    await page.getByRole('heading',{name:'This recording is already saved'}).waitFor();
    await page.getByRole('button',{name:'Use saved lecture',exact:true}).click();
    assert.equal(requests.length,beforeDuplicate);
    console.log('PASS duplicate upload: saved recording reused without another notes request');
    await page.goto(base+'index.html?capture=1'); await ready();
    await page.evaluate(async()=>{
        const {Recorder}=await import('./js/recorder.js'); const open=Recorder.prototype.open;
        Recorder.prototype.open=function(){this.boundaries={targetMs:1000,maxExtraMs:100,overlapMs:100};return open.call(this);};
    });
    mode='success';audioCalls=0;audioFailure=true;
    await page.locator('#start-record-btn').click();
    await page.waitForFunction(()=>document.querySelector('#processing-problem-title').textContent.includes('Transcribe audio needs attention'));
    assert(await page.locator('#stop-record-btn').isVisible());
    assert.match(await page.locator('#recording-caption').textContent(),/microphone is still recording/);
    assert.match(await page.locator('#processing-preserved').textContent(),/remaining audio still needs transcription/);
    await page.locator('#stop-record-btn').click();
    await page.waitForFunction(()=>document.querySelector('#stop-record-btn').hidden && !document.querySelector('#processing-problem').hidden && !document.querySelector('#recording-caption').textContent.includes('microphone is still recording'));
    await page.waitForFunction(()=>[...document.querySelectorAll('#queue-recovery button')].filter(b=>b.textContent==='Resume saved work').every(b=>!b.disabled || b.closest('[data-lecture-id]').dataset.lectureId==='http429'));
    audioFailure=false;
    console.log('PASS fresh capture: upload-note cancellation, partial transcript warning, Stop remains usable during live transcription failure');
    // A failed audio write must retain RAM audio and leave recovery usable after capture stops.
    await page.goto(base+'index.html?capture=1'); await ready();
    await page.evaluate(async()=>{
        const {Recorder}=await import('./js/recorder.js'); const open=Recorder.prototype.open;
        Recorder.prototype.open=function(){this.boundaries={targetMs:1000,maxExtraMs:100,overlapMs:100};return open.call(this);};
        const put=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(...args){
            if(this.name==='chunks'){IDBObjectStore.prototype.put=put;throw new DOMException('Test storage full','QuotaExceededError');}
            return put.apply(this,args);
        };
    });
    await page.locator('#start-record-btn').click();
    await page.waitForFunction(()=>!document.querySelector('#processing-problem').hidden && document.querySelector('#processing-reason').textContent.includes('could not save'));
    assert.match(await page.locator('#processing-preserved').textContent(),/only in this tab/);
    await page.locator('#processing-retry').click();
    await page.locator('#result-section.active-view').waitFor();
    assert.match(await page.locator('#summary-content').textContent(),/Python uses indentation/);
    await page.waitForFunction(()=>[...document.querySelectorAll('#queue-recovery button')].filter(b=>b.textContent==='Resume saved work').every(b=>!b.disabled || b.closest('[data-lecture-id]').dataset.lectureId==='http429'));
    console.log('PASS storage interruption: retained RAM audio can be retried through to saved notes');
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
    const questionCalls=requests.length;
    await page.locator('#lecture-question-form button[type=submit]').click();
    await page.waitForFunction(() => document.getElementById('lecture-answer').textContent.includes('p0:'));
    assert.equal(requests.length,questionCalls);
    mode='bad-answer'; await page.locator('#lecture-question').fill('Explain Python indentation.');await page.locator('#lecture-question-form button[type=submit]').click();
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
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>{window.print=()=>{window.printRequested=true;};});
    await page.locator('#export-menu summary').click();
    await page.locator('[data-export="export-pdf"]').click();
    await page.locator('#print-options[open]').waitFor();
    await page.getByRole('button',{name:'Continue to print'}).click();
    assert.equal(await page.evaluate(()=>window.printRequested),true);
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('#panel-transcript').isVisible(),false);
    assert.equal(await page.locator('#panel-recall').isVisible(),true);
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
    const pdfPath=join(tmpdir(),'delectured-study-notes.pdf');
    await page.pdf({path:pdfPath,preferCSSPageSize:true,printBackground:false});
    await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({media:'screen'});
    await page.locator('#export-menu summary').click();
    await page.locator('[data-export="export-pdf"]').click();
    await page.locator('#print-scope').selectOption('full');
    await page.getByRole('button',{name:'Continue to print'}).click();
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('#panel-transcript').isVisible(),true);
    await page.emulateMedia({media:'screen'});
    console.log(`PASS PDF: scope chooser, study notes exclude transcript, full export includes transcript; generated ${pdfPath}`);
    saved = await page.evaluate(async () => (await import('./js/store.js')).getLecture('final'));
    assert.equal(saved.status,'ready'); assert.equal(saved.analysisStatus,'ready');
    assert.deepEqual(errors,[]); assert.deepEqual(missing,[]); assert.deepEqual(dialogs,[]);
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
