// Run after npm run build; args: Playwright module path, Edge/Chromium executable.
// Isolated profile and fake credentials. All provider requests are intercepted.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.argv[2]));
const root=resolve('dist');
const server=createServer(async(req,res)=>{
    try {
        const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
        if(!path.startsWith(root+sep))throw Error();
        res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html');
        res.end(await readFile(path));
    }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
let browser;
try {
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const context=await browser.newContext({serviceWorkers:'block'}), page=await context.newPage();
    const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',async route=>{
        const req=route.request();if(req.url().startsWith(base))return route.continue();
        if(req.url()==='https://api.groq.com/openai/v1/audio/transcriptions'){
            assert.equal(req.headers().authorization,'Bearer audio-fixture');
            calls.push('audio');return route.fulfill({json:{text:'Python uses indentation.',segments:[]}});
        }
        if(req.url()==='https://api.openai.com/v1/chat/completions'){
            assert.equal(req.headers().authorization,'Bearer notes-fixture');
            const body=req.postDataJSON(),payload=JSON.parse(body.messages[1].content);
            assert.equal(body.model,'notes-fixture-model');calls.push('notes');
            const evidence=[{sourceId:payload.source.id,quote:'Python uses indentation.'}];
            return route.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({notes:'Python uses indentation.',evidence,topics:['Python'],concepts:[],flashcards:[],examSignals:[],links:[]})}}]}});
        }
        assert.fail('Unexpected provider endpoint');
    });
    await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.routerReady==='true');
    const choose=async(id,name)=>{await page.locator(`#${id}-choice`).click();await page.locator(`#${id}-options`).getByRole('option',{name,exact:true}).click();};
    await page.locator('#keys-drawer-btn').click();
    assert(await page.locator('#key-groq').isVisible());assert(!await page.locator('#key-openai').isVisible());
    await choose('notes-provider','OpenAI');
    assert(await page.locator('#key-openai').isVisible());
    assert(!await page.locator('#model-groq-completion').isVisible());
    assert(!await page.locator('#model-openai-transcription').isVisible());
    await page.locator('#key-groq').fill('audio-fixture');
    await page.locator('#key-openai').fill('notes-fixture');
    await page.locator('#model-openai-completion').fill('notes-fixture-model');
    // Switching temporarily must preserve entered fields, but only selected settings save.
    await choose('notes-provider','Custom OpenAI-compatible');
    assert(await page.locator('#compatible-base-url').isVisible());
    await page.locator('#compatible-base-url').fill('invalid unused URL');
    await choose('notes-provider','OpenAI');
    assert(!await page.locator('#compatible-base-url').isVisible());
    assert.equal(await page.locator('#key-openai').inputValue(),'notes-fixture');
    await page.locator('#save-keys-btn').click();
    await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.routerReady==='true');
    await page.locator('#keys-drawer-btn').click();
    assert.equal(await page.locator('#notes-provider').inputValue(),'openai');
    assert.equal(await page.locator('#transcription-provider').inputValue(),'groq');
    assert(await page.locator('#model-openai-completion').isVisible());
    await choose('notes-provider','Groq');
    assert(await page.locator('#model-groq-completion').isVisible());
    assert(!await page.locator('#key-openai').isVisible());
    await page.locator('#save-keys-btn').click();
    await page.locator('#keys-drawer-btn').click();await choose('notes-provider','OpenAI');
    assert.equal(await page.locator('#key-openai').inputValue(),'notes-fixture');
    assert.equal(await page.locator('#model-openai-completion').inputValue(),'notes-fixture-model');
    await page.locator('#save-keys-btn').click();
    const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);
    wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
    await page.goto(base+'index.html?capture=1');await page.waitForFunction(()=>document.documentElement.dataset.routerReady==='true');
    await page.locator('#file-input').setInputFiles({name:'separate-providers.wav',mimeType:'audio/wav',buffer:wav});
    await page.locator('#result-section.active-view').waitFor();
    assert.match(await page.locator('#summary-content').textContent(),/Python uses indentation/);
    const saved=await page.evaluate(async()=> (await (await import('./js/store.js')).getAllLectures()).find(l=>l.title==='separate-providers.wav'));
    assert.equal(saved.providerSelections.transcription.providerId,'groq');
    assert.equal(saved.providerSelections.completion.providerId,'openai');
    assert.equal(saved.status,'ready');assert.deepEqual(calls,['audio','notes']);assert.deepEqual(errors,[]);
    console.log('PASS selected-provider fields, shared provider, saved hidden credentials, reload, custom URL visibility, and Groq audio → OpenAI notes through the final panel');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
