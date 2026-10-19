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
        const {uploadLecture}=await import('./js/upload.js');
        const {Output,BufferTarget,AudioBufferSource,WavOutputFormat,Mp4OutputFormat,canEncodeAudio}=await import('./js/vendor/mediabunny/mediabunny.js');
        const results=[];
        for(const codec of ['pcm-s16','aac']) {
            if(codec==='aac'&&!await canEncodeAudio('aac')){results.push('AAC encoder unavailable: skipped');continue;}
            const target=new BufferTarget(),output=new Output({format:codec==='aac'?new Mp4OutputFormat():new WavOutputFormat(),target});
            const source=new AudioBufferSource({codec,bitrate:128000});output.addAudioTrack(source);
            const audio=new AudioBuffer({numberOfChannels:2,sampleRate:44100,length:88200});
            for(let c=0;c<2;c++){const data=audio.getChannelData(c);for(let i=0;i<data.length;i++)data[i]=0.1*Math.sin(i*2*Math.PI*(440+c*220)/44100);}
            await output.start();await source.add(audio);source.close();await output.finalize();
            const parts=[];
            await uploadLecture(new File([target.buffer],codec==='aac'?'stereo.m4a':'stereo.wav'),{onChunk:p=>parts.push(p)});
            if(parts.length!==1||Math.abs(parts[0].durationMs-2000)>150||parts[0].blob.type!=='audio/mpeg')throw Error('Invalid converted audio');
            results.push(codec+': stereo 44.1kHz converted to mono MP3');
        }
        let safe=false;try{await uploadLecture(new File(['corrupt'],'broken.m4a'),{onChunk:()=>{throw Error('Must not emit');}});}catch(e){safe=e.kind==='input'&&e.reason==='decode';}
        if(!safe)throw Error('Missing codec failure explanation');
        return results;
    });
    console.log('PASS codec conversion and corrupt-file error:',result);
} finally {await browser?.close();await new Promise(r=>server.close(r));}
