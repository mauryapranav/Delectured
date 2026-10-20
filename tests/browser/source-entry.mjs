// Synthetic storage only. Verify recovery from a source server without
// changing origin, deleting data, or contacting any model provider.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.argv[2]));
const root=resolve('.');
const server=createServer(async(req,res)=>{
    try {
        const path=new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html');
        const file=resolve(root,'.'+path);
        if(!file.startsWith(root+sep))throw Error();
        res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':'text/html');
        res.end(await readFile(file));
    }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/index.html');
    await page.locator('h1').filter({hasText:'Open the built app'}).waitFor();
    await page.evaluate(async()=>{
        const store=await import('./js/store.js');
        await store.saveLecture({id:'source-recovery',title:'Preserved lecture',transcript:'Saved transcript stays here.'});
    });
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('main').textContent.includes('Found 1 readable saved lecture'));
    await page.getByRole('link',{name:'Open the complete app'}).click();
    await page.waitForFunction(()=>document.documentElement.dataset.routerReady==='true');
    assert.equal(new URL(page.url()).origin,base);
    assert.equal(await page.evaluate(async()=>(await (await import('./js/store.js')).getLecture('source-recovery')).transcript),'Saved transcript stays here.');
    await page.locator('.workspace-nav a[href="library.html"]').click();
    await page.locator('#library-section.active-view').waitFor();
    assert.match(await page.locator('#library-list').textContent(),/Preserved lecture/);
    assert.deepEqual(errors,[]);
    console.log('PASS source recovery: visible explanation, saved record count, same-origin built app, transcript and Library preserved');
}finally{
    await browser?.close();
    await new Promise(r=>server.close(r));
}
