// Local synthetic animation profiling. No real credentials or provider calls.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
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
const results=[];
try {
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const source=await readFile(resolve(root,'ink-transition.js'),'utf8');
    // The blur comparison is only meaningful for the original SVG renderer.
    for(const variant of source.includes('feGaussianBlur')?['normal','without-blur']:['normal']) {
        const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',colorScheme:'light'});
        if(variant==='without-blur')await context.route('**/ink-transition.js',async route=>{
            const response=await route.fetch();
            await route.fulfill({response,body:(await response.text()).replace(/wash\.setAttribute\('filter', `url\(#\$\{filterId\}\)`\);/,'')});
        });
        const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
        const session=await context.newCDPSession(page);await session.send('Performance.enable');
        for(let run=0;run<2;run++) {
            const before=(await session.send('Performance.getMetrics')).metrics;
            const timing=await page.evaluate(()=>new Promise(resolve=>{
                const frames=[],start=performance.now();let previous=start;
                function sample(now){
                    frames.push(now-previous);previous=now;
                    if(now-start>150&&!document.querySelector('.theme-clone')&&!document.documentElement.hasAttribute('data-ink-running')) {
                        const sorted=frames.slice(1).sort((a,b)=>a-b);
                        resolve({elapsed:now-start,frames:sorted.length,p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted),over25ms:sorted.filter(n=>n>25).length});
                    } else requestAnimationFrame(sample);
                }
                requestAnimationFrame(sample);window.InkTransition.toggle();
            }));
            const after=(await session.send('Performance.getMetrics')).metrics;
            const delta=name=>Math.round(1000*(after.find(m=>m.name===name).value-before.find(m=>m.name===name).value));
            results.push({variant,run,...timing,taskMs:delta('TaskDuration'),layoutMs:delta('LayoutDuration'),styleMs:delta('RecalcStyleDuration')});
        }
        await context.close();
    }
    await writeFile(`docs/design/implemented/ink-profile-${process.argv[4]||'latest'}.json`,JSON.stringify(results,null,2));
    console.log(JSON.stringify(results,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
