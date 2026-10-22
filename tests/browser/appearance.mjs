// Isolated synthetic demo, no provider traffic or personal browser storage.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.argv[2]));
const root=resolve('dist');
const server=createServer(async(req,res)=>{
    try {
        const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
        if(!path.startsWith(root+sep))throw Error();
        res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css'})[extname(path)]||'text/html');
        res.end(await readFile(path));
    }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/index.html?demo=folio');
    await page.waitForSelector('html[data-router-ready="true"]');
    assert(await page.locator('.study-annotation').count()>0);
    const originalTheme=await page.locator('html').getAttribute('data-theme');
    await page.locator('#appearance-toggle').click();
    assert.equal(await page.locator('html').getAttribute('data-appearance'),'modern');
    assert.equal(await page.locator('html').getAttribute('data-theme'),originalTheme);
    await page.reload();
    await page.waitForSelector('html[data-router-ready="true"]');
    assert.equal(await page.locator('html').getAttribute('data-appearance'),'modern');
    for(const width of [390,1440]) {
        await page.setViewportSize({width,height:1000});
        for(const style of ['classic','modern']) for(const theme of ['light','dark']) {
            if(await page.locator('html').getAttribute('data-appearance')!==style)await page.locator('#appearance-toggle').click();
            await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${style} ${theme} ${width} overflow`);
            assert(await page.locator('#appearance-toggle').isVisible());
            assert(await page.evaluate(()=>[...document.querySelectorAll('.study-annotation')].every(node=>node.scrollWidth<=node.clientWidth+1)));
            if(style==='modern')assert.equal(await page.locator('#panel-notes').evaluate(n=>getComputedStyle(n).backgroundImage),'none');
        }
    }
    await page.screenshot({path:join(tmpdir(),'delectured-modern-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.locator('#appearance-toggle').click();
    await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
    await page.screenshot({path:join(tmpdir(),'delectured-paper-mobile.png')});
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('#appearance-toggle').isVisible(),false);
    assert.equal(await page.locator('#panel-notes').evaluate(n=>getComputedStyle(n).backgroundImage),'none');
    assert.deepEqual(errors,[]);
    console.log('PASS appearance: persistence, theme independence, annotations, mobile/desktop light/dark styles and print');
    console.log(join(tmpdir(),'delectured-modern-desktop.png'));
    console.log(join(tmpdir(),'delectured-paper-mobile.png'));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
