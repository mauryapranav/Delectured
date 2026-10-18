// Run after build; args: Playwright module path, Edge/Chromium executable.
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
let browser;
try {
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?demo=folio`);
    await page.locator('#result-section.active-view').waitFor();
    // Put the contents links in view before measuring; Playwright click may scroll to them.
    await page.locator('#page-contents').scrollIntoViewIfNeeded();
    const before=await page.evaluate(()=>scrollY);
    await page.locator('#page-contents a').last().click();
    assert(await page.locator('#panel-notes').evaluate(el=>el.scrollTop>0));
    assert.equal(await page.evaluate(()=>scrollY),before);
    await page.locator('#page-contents a').first().click();
    assert.equal(await page.evaluate(()=>scrollY),before);
    assert.equal(await page.locator('#panel-notes').evaluate(el=>el.scrollTop),0);
    const colors=[];
    for(const theme of ['light','dark']){
        colors.push(await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;return getComputedStyle(document.documentElement).scrollbarColor;},theme));
    }
    assert.notEqual(colors[0],colors[1]);assert(colors.every(c=>c!=='auto'));
    await page.setViewportSize({width:390,height:844});
    await page.locator('#contents-select-choice').scrollIntoViewIfNeeded();
    const mobileBefore=await page.evaluate(()=>scrollY);
    await page.locator('#contents-select-choice').click();
    await page.locator('#contents-select-options [role=option]').last().click();
    assert(await page.locator('#panel-notes').evaluate(el=>el.scrollTop>0));
    assert.equal(await page.evaluate(()=>scrollY),mobileBefore);
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('#panel-notes').evaluate(el=>getComputedStyle(el).maxHeight),'none');
    assert.equal(await page.locator('#panel-notes').evaluate(el=>getComputedStyle(el).overflowY),'visible');
    assert.deepEqual(errors,[]);
    console.log('PASS desktop/mobile contents scroll only notes; scrollbar follows theme; print is unrestricted');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
