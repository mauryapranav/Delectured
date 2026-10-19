import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uploadLecture, fingerprintUpload} from '../js/upload.js';
import {Session} from '../js/session.js';
import {Queue} from '../js/queue.js';
import {createLectureStore} from '../js/store.js';

test('incremental upload downmixes bounded blocks, preserves gaps, and waits for consumers',async()=>{
    const file=new File(['x'],'test.wav');let closed=false,accepted=false,encoded=0;
    const output=[];
    await uploadLecture(file,{open:async()=>({seconds:301,sampleRate:16000,channels:2,close(){closed=true;},async *samples(){
        for(let timestamp=0;timestamp<301;timestamp++){
            if(timestamp===300)assert(accepted);
            if(timestamp===25)continue;
            yield {timestamp,audio:{sampleRate:16000,numberOfChannels:2,length:16000,getChannelData:c=>new Float32Array(16000).fill(c?0.5:1)}};
        }
    }}),resample:async pcm=>{assert(pcm.length<=30*16000);return pcm;},encode:async pcm=>{
        if(!encoded++){assert.equal(pcm[0],0.75);assert.equal(pcm[25*16000],0);assert.equal(pcm[26*16000],0.75);}
        return new Blob(['encoded']);
    },onChunk:async part=>{await new Promise(r=>setTimeout(r,1));accepted=true;output.push(part);}});
    assert(closed);assert.equal(output.length,2);assert.equal(output[1].durationMs,1000);
});

test('decode cancellation closes the reader and never emits partial audio',async()=>{
    const controller=new AbortController();let closed=false;
    await assert.rejects(uploadLecture(new File(['x'],'a.wav'),{signal:controller.signal,
        open:async()=>({seconds:20,sampleRate:16000,channels:1,close(){closed=true;},async *samples(){controller.abort();yield {audio:{},timestamp:0};}}),
        resample:async p=>p,onChunk:()=>assert.fail('Must not emit')}),{name:'AbortError'});
    assert(closed);
});

test('source fingerprint checks middle bytes as well as names and lengths',async()=>{
    const bytes=new Uint8Array(3*1024*1024);const a=new File([bytes],'same.wav');bytes[1500000]=1;const b=new File([bytes],'same.wav');
    a.arrayBuffer=()=>assert.fail('Must not read complete source');
    assert.notEqual(await fingerprintUpload(a),await fingerprintUpload(b));
});

test('interrupted upload needs matching source after reload and resumes saved transcription exactly once',async()=>{
    const store=createLectureStore(crypto.randomUUID());let calls=0;
    const queue=new Queue({store,transcribe:async()=>{calls++;return {text:'Saved text.'};},online:()=>true});
    const file=new File(['original'],'lecture.wav');
    const upload=async(file,{onChunk,startIndex})=>{
        if(!startIndex){await onChunk({index:0,startMs:0,durationMs:300000,blob:new Blob(['a'])});throw Object.assign(new Error('Decode interrupted'),{kind:'input',reason:'decode'});}
        assert.equal(startIndex,1);
        await onChunk({index:1,startMs:300000,durationMs:2000,blob:new Blob(['b'])});return {durationMs:302000};
    };
    const first=new Session({store,queue,upload});
    await assert.rejects(first.upload(file,{id:'resume'}),/interrupted/);
    assert.equal(calls,1);assert.equal((await store.getLecture('resume')).uploadSource.complete,false);
    const reloaded=new Session({store,queue,upload});
    await assert.rejects(reloaded.recover('resume',{retry:true}),{reason:'source_required'});
    await assert.rejects(reloaded.recover('resume',{retry:true,file:new File(['wrong'],'lecture.wav')}),{reason:'source_mismatch'});
    assert.equal(calls,1);
    await reloaded.recover('resume',{retry:true,file});
    assert.equal(calls,2);assert.equal((await store.getLecture('resume')).uploadSource.complete,true);
    assert.deepEqual((await store.getLecture('resume')).captureGaps,[]);
    await store.close();
});
