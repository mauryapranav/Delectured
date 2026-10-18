// Build first. Args: Playwright module path, Chromium/Edge executable.
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
        res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html');res.end(await readFile(path));
    }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
let browser;
try {
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],calls=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',async route=>{
        const r=route.request(),url=new URL(r.url());if(r.url().startsWith(base))return route.continue();
        calls.push(url.pathname);
        if(url.pathname==='/openai/v1/models')return route.fulfill({json:{data:[{id:'whisper-large-v3-turbo'},{id:'openai/gpt-oss-120b'},{id:'tts-voice'}]}});
        if(url.pathname==='/v1beta/models'){
            assert.equal(r.headers()['x-goog-api-key'],'notes-test');
            return route.fulfill({json:{models:[{name:'models/gemini-3.5-flash-lite',supportedGenerationMethods:['generateContent']},{name:'models/text-embedding',supportedGenerationMethods:['embedContent']}]}});
        }
        if(url.pathname.endsWith('/audio/transcriptions')){
            assert.equal(r.headers().authorization,'Bearer audio-test');return route.fulfill({json:{text:'Python uses indentation.',segments:[]}});
        }
        if(url.pathname==='/v1beta/openai/chat/completions'){
            assert.equal(r.headers().authorization,'Bearer notes-test');const b=r.postDataJSON();assert.equal(b.model,'gemini-3.5-flash-lite');
            const p=JSON.parse(b.messages[1].content);
            return route.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({notes:'Python uses indentation.',evidence:[{sourceId:p.source.id,quote:'Python uses indentation.'}],topics:['Python'],concepts:[],flashcards:[],examSignals:[],links:[]})}}]}});
        }
        assert.fail('Unexpected external request');
    });
    await page.goto(base+'index.html?capture=1');await page.waitForFunction(()=>document.documentElement.dataset.routerReady==='true');
    await page.locator('#file-input').setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('bad')});
    await page.locator('#processing-problem:not([hidden])').waitFor();
    assert.match(await page.locator('#processing-reason').textContent(),/file type/);assert.equal(calls.length,0);
    assert.match(await page.locator('#processing-diagnostic').textContent(),/file_format/);
    const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);
    wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
    await page.locator('#file-input').setInputFiles({name:'first-lecture.wav',mimeType:'audio/wav',buffer:wav});
    await page.locator('#keys-drawer.open').waitFor();
    assert.match(await page.locator('#pending-upload-notice').textContent(),/Nothing has been uploaded/);
    await page.locator('#close-drawer-btn').click();
    await page.locator('#file-input').setInputFiles({name:'replacement.txt',mimeType:'text/plain',buffer:Buffer.from('bad')});
    await page.waitForFunction(()=>document.querySelector('#processing-reason').textContent.includes('file type'));
    assert.equal(await page.locator('#pending-upload-notice').count(),0);
    await page.locator('#file-input').setInputFiles({name:'first-lecture.wav',mimeType:'audio/wav',buffer:wav});
    await page.locator('#keys-drawer.open').waitFor();
    await page.getByRole('button',{name:'Cancel selected file',exact:true}).click();
    assert.equal(await page.locator('#pending-upload-notice').count(),0);
    await page.locator('#close-drawer-btn').click();
    await page.locator('#file-input').setInputFiles({name:'first-lecture.wav',mimeType:'audio/wav',buffer:wav});
    await page.locator('#keys-drawer.open').waitFor();
    await page.locator('#notes-provider-choice').click();await page.locator('#notes-provider-options').getByRole('option',{name:'Google Gemini',exact:true}).click();
    await page.locator('#key-groq').fill('audio-test');await page.locator('#find-models-groq').click();
    await page.locator('#choose-groq-transcription-choice').waitFor();
    assert.equal(await page.locator('#model-groq-transcription').inputValue(),'whisper-large-v3-turbo');
    await page.locator('#key-gemini').fill('notes-test');
    await page.locator('#model-gemini-completion').fill('manual-account-model');
    await page.locator('#find-models-gemini').click();
    await page.locator('#choose-gemini-completion-choice').waitFor();
    assert.equal(await page.locator('#model-gemini-completion').inputValue(),'manual-account-model');
    assert(await page.locator('#model-gemini-completion').isVisible());
    await page.locator('#model-gemini-completion').fill('');
    await page.locator('#find-models-gemini').click();
    await page.locator('#choose-gemini-completion-choice').waitFor();
    assert.equal(await page.locator('#model-gemini-completion').inputValue(),'gemini-3.5-flash-lite');
    assert.equal(await page.locator('#choose-gemini-completion option').count(),2);
    await page.locator('#save-keys-btn').click();
    await page.locator('#result-section.active-view').waitFor();
    assert.match(await page.locator('#summary-content').textContent(),/Python uses indentation/);
    assert.equal(calls.filter(x=>x.endsWith('/audio/transcriptions')).length,1);
    assert.equal(calls.filter(x=>x.endsWith('/chat/completions')).length,1);
    assert.deepEqual(errors,[]);
    console.log('PASS invalid-file explanation; first-time file retention; model discovery and selection; Groq transcription → Gemini notes without reselecting file');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
