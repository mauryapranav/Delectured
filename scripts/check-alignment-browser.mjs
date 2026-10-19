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
    for(const [width,height] of [[1440,900],[1852,1148],[1280,720],[390,844]]) {
      for(const collapsed of [false,true]) {
        await page.setViewportSize({width,height});
        const positions=[];
        for(const [route,section,controls] of [['index.html?capture=1','#input-section','.capture-choices'],['library.html','.library-section','.library-toolbar']]) {
          await page.goto(base+'/'+route); await page.locator(section+' h1').waitFor();
          if(collapsed)await page.evaluate(()=>document.body.classList.add('sidebar-collapsed'));
          positions.push(await page.locator(section).evaluate((n,controls)=>{
            const box=s=>n.querySelector(s).getBoundingClientRect();
            return {x:box('h1').x,y:box('h1').y,eyebrow:box('.eyebrow').y,intro:box('.home-intro').y,gap:box(controls).top-box('.home-intro').bottom};
          },controls));
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          if(width===1440&&!collapsed)await page.screenshot({path:'docs/design/implemented/aligned-'+(route.startsWith('index')?'capture':'library')+'.png'});
        }
        for(const key of ['x','y','eyebrow','intro','gap'])assert(Math.abs(positions[0][key]-positions[1][key])<1,`${width} ${key}: ${JSON.stringify(positions)}`);
      }
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: Capture/Library heading, eyebrow, description and control spacing match at four sizes with sidebar open/collapsed; no overflow or page errors');
} finally {await browser?.close();server.close();}
