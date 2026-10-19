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
    for(const [width,height] of [[1440,900],[1280,720],[2048,1047],[390,844]]) {
        await page.setViewportSize({width,height});await page.goto(base+'/index.html');
        await page.locator('#welcome-title').waitFor({state:'visible'});
        assert.match(await page.locator('#welcome-title').innerText(),/Every Lecture\.\nEvery Word\.\nStructured\./);
        assert(await page.locator('#getting-started').evaluate(n=>n.getBoundingClientRect().top)>=height-1,'Next chapter peeks into first page');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
        if(width>900) {
            const pos=await page.locator('.sidebar-primary').boundingBox();
            assert(pos.y+pos.height<360,'Main routes buried');
            assert.equal(await page.locator('[data-route="home"]').getAttribute('aria-current'),'page');
            await page.screenshot({path:`docs/design/implemented/pages-home-${width}.png`});
            await page.locator('.welcome-index a').first().click();
            await page.waitForTimeout(600);
            const chapter=await page.locator('#getting-started').boundingBox();
            assert(Math.abs(chapter.y)<=2,'Chapter does not start at page top: '+JSON.stringify(chapter));
            const foot=await page.locator('.setup-footnote').boundingBox();
            assert(foot.y+foot.height<=Math.max(height,chapter.height)+2,'Setup content clipped');
            await page.screenshot({path:`docs/design/implemented/pages-setup-${width}.png`});
        } else {
            await page.locator('#sidebar-toggle').click();
            await page.locator('.sidebar-primary a[data-route="library"]').click();
            await page.waitForURL('**/library.html');
            await page.locator('#sidebar-toggle').click();
            await page.screenshot({path:'docs/design/implemented/pages-mobile-sidebar.png'});
            assert.equal(await page.locator('[data-route="library"]').getAttribute('aria-current'),'page');
        }
    }
    await page.setViewportSize({width:1440,height:900});await page.goto(base+'/index.html');
    await page.locator('#theme-toggle').click();
    await page.screenshot({path:'docs/design/implemented/pages-home-dark.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: complete first page, chapter anchor, top sidebar routes, mobile navigation, requested headline and no page errors');
} finally {await browser?.close();server.close();}

