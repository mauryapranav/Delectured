// Local visual fixtures; no provider calls, real credentials or Library mutations.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.argv[2]));
const root=resolve('dist');
const server=createServer(async(req,res)=>{
    try {
        const pathname=new URL(req.url,'http://localhost').pathname;
        const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
        if(!path.startsWith(root+sep))throw Error('Invalid path');
        res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css'})[extname(path)]||'text/html');
        res.end(await readFile(path));
    }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
    await mkdir('docs/design/implemented',{recursive:true});
    browser=await chromium.launch({headless:true,executablePath:process.argv[3],args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
    const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'allow',reducedMotion:'reduce',colorScheme:'light'});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base=`http://127.0.0.1:${server.address().port}`;
    await page.goto(base+'/library.html?q=hello');
    await page.waitForFunction(()=>document.documentElement.dataset.routerReady==='true');
    assert.equal(await page.locator('#library-search').inputValue(),'hello');
    await page.evaluate(()=>{window.originalShell=document.querySelector('.masthead');window.originalSidebar=document.querySelector('.sidebar');});
    for(let i=0;i<3;i++) {
      await page.locator('.workspace-nav a').first().click();
      await page.locator('#input-section').waitFor({state:'visible'});
      await page.locator('.workspace-nav a').last().click();
      await page.locator('#library-section').waitFor({state:'visible'});
    }
    assert(await page.evaluate(()=>originalShell===document.querySelector('.masthead')&&originalSidebar===document.querySelector('.sidebar')&&performance.getEntriesByType('navigation').length===1));
    await page.locator('#workspace-query').fill('vectors');await page.locator('.workspace-search button').click();
    await page.waitForURL('**/library.html?q=vectors');
    assert.equal(await page.locator('#library-search').inputValue(),'vectors');
    await page.goBack();await page.waitForURL('**/library.html');
    await page.goBack();await page.waitForURL('**/index.html?capture=1');await page.locator('#input-section').waitFor({state:'visible'});
    await page.goForward();await page.waitForURL('**/library.html');await page.locator('#library-section').waitFor({state:'visible'});
    await page.locator('[data-route="guide"]').click();await page.locator('#guide-section').waitFor({state:'visible'});
    await page.locator('#keys-drawer-btn').click();await page.locator('#notes-provider-choice').waitFor({state:'visible'});await page.keyboard.press('Escape');
    await page.locator('[data-route="home"]').click();await page.locator('.sample-link').click();await page.locator('#result-section').waitFor({state:'visible'});
    assert(await page.locator('#rename-report').isDisabled());
    await page.evaluate(async()=>{const {saveLecture}=await import('./js/store.js');const {folioSample}=await import('./js/demo-lecture.js');await saveLecture({...folioSample(),id:'route-fixture',title:'Saved routing fixture'});});
    await page.locator('.back-library').click();await page.locator('[data-id="route-fixture"][data-action="view"]').click();
    await page.waitForURL('**/index.html?lecture=route-fixture');
    assert.equal(await page.locator('#rename-report').isDisabled(),false);
    assert.equal(await page.locator('#sample-notice').isVisible(),false);
    assert.equal(await page.locator('#lecture-question').isDisabled(),false);
    assert(await page.evaluate(()=>originalShell===document.querySelector('.masthead')));
    console.log('PASS: direct URL, persistent DOM, repeated navigation, search, history, Guide/settings and sample-to-saved controls');
    await page.locator('.workspace-nav a').first().click();
    await page.evaluate(async()=>{(await import('./js/config.js')).saveConfig({keys:{groq:'fixture'}});});
    await page.reload(); await page.waitForFunction(()=>document.documentElement.dataset.routerReady==='true');
    await page.locator('#start-record-btn').click();await page.waitForFunction(()=>document.querySelector('#recording-caption').textContent.includes('Recording'));
    const recordingUrl=page.url();
    await page.locator('.workspace-nav a').last().click();assert.equal(page.url(),recordingUrl);
    await page.evaluate(()=>history.back());await page.waitForTimeout(250);assert.equal(page.url(),recordingUrl);
    assert(await page.locator('#recording-section').isVisible());
    await page.locator('#discard-record-btn').click();await page.locator('#input-section').waitFor({state:'visible'});
    await page.locator('.workspace-nav a').last().click();await page.locator('#library-section').waitFor({state:'visible'});
    console.log('PASS: live recording blocks link and Back navigation; discard restores routing');
    await page.setViewportSize({width:390,height:844});await page.locator('#sidebar-toggle').click();
    await page.locator('[data-route="home"]').click();await page.locator('#welcome-section').waitFor({state:'visible'});
    assert.equal(await page.locator('main').evaluate(n=>n.inert),false);
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'false');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.routerReady==='true');
    await context.setOffline(true);
    await page.locator('.mobile-nav a').filter({hasText:'Library'}).click();await page.locator('#library-section').waitFor({state:'visible'});
    await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.routerReady==='true');await page.locator('#library-section').waitFor({state:'visible'});
    await context.setOffline(false);
    const raceContext = await browser.newContext({serviceWorkers:'block'}); const race = await raceContext.newPage();
    await race.route('**/index.html?router-test', r=>r.fulfill({contentType:'text/html',body:'<main><section class="active-view"><h1>Router fixture</h1></section></main><a id="report" href="index.html?lecture=slow">Report</a><a id="capture" href="index.html?capture=1">Capture</a><a id="guide" href="guide.html">Guide</a>'}));
    await race.goto(base+'/index.html?router-test');
    await race.evaluate(async()=>{
      const {initRouter}=await import('./js/router.js');window.hold=false;window.busy=false;
      await initRouter({busy:()=>window.busy,blocked:()=>{},changed:()=>{},openSettings:()=>{},error:e=>{throw e;},prepare:async url=>{
        if(window.hold&&url.searchParams.has('lecture'))await new Promise(r=>window.release=r);
        return ()=>{};
      }});
    });
    await race.locator('#report').click();await race.locator('#capture').click();
    await race.evaluate(()=>{window.hold=true;history.back();});await race.waitForFunction(()=>!!window.release);
    await race.locator('#guide').click();assert.equal(await race.evaluate(()=>history.state.folioPosition),2);
    await race.evaluate(()=>window.release());await race.locator('#capture').click();
    await race.evaluate(()=>{window.busy=true;history.back();});await race.waitForTimeout(200);
    assert.match(race.url(),/capture=1/);
    await raceContext.close();
    console.log('PASS: interrupted slow Back navigation preserves history offsets and recording guard');
    assert.deepEqual(errors,[]);
    console.log('PASS: mobile drawer closes and releases focus; offline switching and direct reload work; no page errors');
} finally {await browser?.close();server.close();}

