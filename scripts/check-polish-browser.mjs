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
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',reducedMotion:'reduce',colorScheme:'light'});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base=`http://127.0.0.1:${server.address().port}`;
    const metrics=[];
    for(const [route,heading] of [['index.html','#welcome-title'],['index.html?capture=1','#input-section h1'],['library.html','.library-section h1'],['guide.html','.guide-title']]) {
        await page.goto(`${base}/${route}`);await page.locator(heading).waitFor({state:'visible'});
        metrics.push(await page.locator(heading).evaluate(n=>({x:n.getBoundingClientRect().x,size:getComputedStyle(n).fontSize})));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    assert(metrics.every(m=>Math.abs(m.x-metrics[0].x)<=1&&m.size===metrics[0].size),JSON.stringify(metrics));
    for(const [width,height] of [[1440,900],[1280,720]]) {
        await page.setViewportSize({width,height});await page.goto(base+'/index.html?capture=1');
        await page.locator('#start-record-btn').waitFor({state:'visible'});
        const bottom=await page.locator('#input-section .privacy-note').evaluate(n=>n.getBoundingClientRect().bottom);
        assert(bottom<=height,`Capture bottom ${bottom} exceeds ${height}`);
        await page.screenshot({path:`docs/design/implemented/polish-capture-${width}.png`});
    }
    console.log('PASS: Home/Capture/Library/Guide share heading size and alignment; desktop capture controls fit complete views');
    await page.setViewportSize({width:1440,height:900});await page.goto(base+'/library.html');
    const trigger=page.locator('#import-conflicts-choice');await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'),'true');
    const activeColor=await page.locator('#import-conflicts-option-0').evaluate(n=>getComputedStyle(n).backgroundColor);
    assert.notEqual(activeColor,'rgb(0, 120, 215)');
    await page.screenshot({path:'docs/design/implemented/polish-library-picker-light.png'});
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.equal(await page.locator('#import-conflicts').inputValue(),'overwrite');
    assert.match(await trigger.textContent(),/Replace matching/);
    await trigger.click();await page.keyboard.press('Home');await page.keyboard.press('Escape');
    assert.equal(await page.locator('#import-conflicts').inputValue(),'overwrite');
    await page.locator('#import-conflicts').selectOption('reject');assert.match(await trigger.textContent(),/Keep existing/);
    await page.locator('#theme-toggle').click();await trigger.click();
    await page.screenshot({path:'docs/design/implemented/polish-library-picker-dark.png'});
    await page.keyboard.press('Escape');
    await page.locator('#workspace-query').fill('vectors');await page.locator('.workspace-search button').click();
    await page.waitForURL('**/library.html?q=vectors');
    assert.equal(await page.locator('#library-search').inputValue(),'vectors');
    console.log('PASS: Paper-themed listbox supports keyboard/cancel, native change synchronization and header search routing');
    await page.goto(base+'/index.html?settings=1');await page.locator('#notes-provider-choice').waitFor({state:'visible'});
    await page.locator('#notes-provider-choice').click();await page.keyboard.press('End');await page.keyboard.press('Enter');
    const selected=await page.locator('#notes-provider').inputValue();assert.equal(selected,'compatible');
    await page.locator('#notes-provider-choice').click();await page.keyboard.press('Escape');
    assert.equal(await page.locator('#keys-drawer').evaluate(n=>n.inert),false);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#keys-drawer').evaluate(n=>n.inert),true);
    console.log('PASS: Provider dropdown Escape closes the popup before the settings dialog');
    await page.goto(base+'/index.html?demo=folio');await page.locator('#sample-notice').waitFor({state:'visible'});
    assert.equal(await page.evaluate(async()=>(await import('./js/store.js')).getAllLectures().then(ls=>ls.length)),0);
    assert.equal(await page.locator('.margin-annotation span:last-child').first().textContent(),'A direction, plus an amount.');
    assert.equal(await page.locator('.explicit-note').getAttribute('aria-hidden'),null);
    const longNote='A longer note should remain readable in the study page. '.repeat(5);
    await page.evaluate(async text=>{
        const sample=(await import('./js/demo-lecture.js')).folioSample();
        sample.analysis.sections[0].notes=sample.analysis.sections[0].notes.replace('A direction, plus an amount.',text);
        (await import('./js/report.js')).renderResults(sample.analysis);
    },longNote);
    assert((await page.locator('#summary-content').textContent()).includes(longNote.trim()));
    await page.reload();await page.locator('#sample-notice').waitFor({state:'visible'});
    await page.setViewportSize({width:900,height:900});
    assert.equal(await page.locator('.explicit-note').isVisible(),true);
    await page.setViewportSize({width:1440,height:900});
    assert.equal(await page.locator('.section-timing').count(),2);
    assert.equal(await page.locator('#regenerate-report').isDisabled(),true);
    assert.equal(await page.locator('#lecture-question').isDisabled(),true);
    assert.equal(await page.locator('.back-library').isVisible(),true);
    await page.locator('#theme-toggle').click();
    await page.screenshot({path:'docs/design/implemented/polish-notes-light.png'});
    await page.locator('#theme-toggle').click();await page.screenshot({path:'docs/design/implemented/polish-notes-dark.png'});
    console.log('PASS: Sample Folio is read-only and includes back/header actions, sourced handwritten annotation and timing badges');
    for(const route of ['index.html','index.html?capture=1','library.html','index.html?demo=folio']) {
        await page.setViewportSize({width:390,height:844});await page.goto(`${base}/${route}`);
        if(route.includes('demo'))await page.locator('#sample-notice').waitFor({state:'visible'});
        const suffix=route.includes('demo')?'notes':route.includes('capture')?'capture':route.includes('library')?'library':'home';
        await page.screenshot({path:`docs/design/implemented/polish-mobile-${suffix}.png`,fullPage:suffix!=='notes'});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route);
        await page.setViewportSize({width:320,height:740});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route+' 320');
    }
    await page.setViewportSize({width:1440,height:900});await page.emulateMedia({media:'print'});
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('#panel-notes').evaluate(n=>getComputedStyle(n).paddingLeft),'0px');
    assert.equal(await page.locator('.explicit-note').isVisible(),true);
    await page.pdf({path:'docs/design/implemented/polish-print.pdf',format:'A4'});
    assert.deepEqual(errors,[]);
    console.log('PASS: 320/390px pages avoid horizontal clipping; annotations remain available on mobile and print preserves full text');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
