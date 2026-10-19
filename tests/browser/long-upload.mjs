// Build first. Uses real decoding/compression; no provider requests.
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
let browser;
try {
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const page=await browser.newPage({serviceWorkers:'block'});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result=await page.evaluate(async()=>{
        const {uploadLecture,fingerprintUpload}=await import('./js/upload.js');
        const {openUpload}=await import('./js/upload-reader.js');
        const seconds=7200,rate=8000;
        const header=new ArrayBuffer(44),v=new DataView(header);
        const word=(at,s)=>Array.from(s).forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
        word(0,'RIFF');v.setUint32(4,36+seconds*rate*2,true);word(8,'WAVEfmt ');v.setUint32(16,16,true);
        v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);
        v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,seconds*rate*2,true);
        const second=new Int16Array(rate);for(let i=0;i<rate;i++)second[i]=Math.round(5000*Math.sin(2*Math.PI*440*i/rate));
        const file=new File([header,...Array(seconds).fill(second)],'two-hours.wav');
        file.arrayBuffer=()=>{throw Error('Whole-file read forbidden');};
        await fingerprintUpload(file);
        let first,parts=0,total=0,maxSize=0,heartbeats=0;
        const timer=setInterval(()=>heartbeats++,10);
        try {
            const result=await uploadLecture(file,{onChunk:async chunk=>{
                if(chunk.index!==parts||chunk.startMs!==parts*300000)throw Error('Incorrect timeline');
                if(!first)first=chunk.blob;
                parts++;total+=chunk.durationMs;maxSize=Math.max(maxSize,chunk.blob.size);
            }});
            const decoded=await openUpload(new File([first],'part.mp3'));
            const mp3Duration=decoded.seconds;decoded.close();
            let roundTripParts=0;
            await uploadLecture(new File([first],'part.mp3'),{onChunk:()=>roundTripParts++});
            return {parts,total,maxSize,heartbeats,duration:result.durationMs,mp3Duration,roundTripParts};
        } finally {clearInterval(timer);}
    });
    assert.equal(result.parts,24);assert.equal(result.total,7200000);assert.equal(result.duration,7200000);
    assert(result.maxSize<2500000);assert(result.heartbeats>10);assert(Math.abs(result.mp3Duration-300)<0.2);
    assert.equal(result.roundTripParts,1);
    console.log('PASS real two-hour WAV incremental decode/resample/MP3 encode, 24 timed parts, MP3 reimport, responsive event loop:',result);
} finally {await browser?.close();await new Promise(r=>server.close(r));}
