import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLectureStore} from '../js/store.js';
import {Queue} from '../js/queue.js';
import {Session} from '../js/session.js';
import {validateAudioUsage} from '../js/schema.js';

test('uploaded audio request cap survives reload and manual retry; approved extension reuses completed transcript', async () => {
    const store = createLectureStore(`audio-budget-${crypto.randomUUID()}`);
    await store.saveLecture({id:'audio', audioUsage:{requests:0,limit:1}});
    for (let index=0; index<2; index++) await store.putChunk({lectureId:'audio', index, blob:new Blob(['audio'])});
    let calls=0;
    const transcribe = async () => {calls++; return {text:`part ${calls}`};};
    const first = new Queue({store,transcribe});
    await assert.rejects(first.drain('audio'), {kind:'budget'});
    assert.equal(calls,1);
    assert.equal((await store.getLecture('audio')).transcript,'part 1');
    await store.close();
    const reloaded = new Queue({store,transcribe});
    await assert.rejects(reloaded.retry('audio'), {kind:'budget'});
    assert.equal(calls,1);
    assert.deepEqual((await store.getLecture('audio')).audioUsage,{requests:1,limit:1});
    assert.equal((await reloaded.getRetainedAudio('audio')).length,1);
    await store.updateLecture('audio',{audioUsage:{requests:1,limit:2}});
    await reloaded.retry('audio');
    assert.equal(calls,2);
    assert.equal((await store.getLecture('audio')).transcript,'part 1\n\npart 2');
    assert.deepEqual((await store.getLecture('audio')).audioUsage,{requests:2,limit:2});
    await store.close();
});

test('failed uploads reserve each provider attempt and stop within their total cap', async () => {
    const store=createLectureStore(`audio-failure-${crypto.randomUUID()}`);
    await store.saveLecture({id:'audio',audioUsage:{requests:0,limit:2}});
    await store.putChunk({lectureId:'audio',index:0,blob:new Blob(['retained'])});
    let calls=0,now=0;
    const queue=new Queue({store,now:()=>now,random:()=>0,wait:async ms=>{now+=ms;},transcribe:async()=>{
        calls++; throw Object.assign(new Error('temporary'),{kind:'network',retryable:true});
    }});
    await assert.rejects(queue.drain('audio'),{kind:'budget'});
    assert.equal(calls,2);
    await assert.rejects(queue.retry('audio'),{kind:'budget'});
    assert.equal(calls,2);
    assert.deepEqual((await store.getLecture('audio')).audioUsage,{requests:2,limit:2});
    assert((await store.getAllChunks('audio'))[0].blob);
    await store.close();
});

test('usage persistence failure prevents transcription; existing live lectures retain existing retry behaviour', async () => {
    const store=createLectureStore(`audio-storage-${crypto.randomUUID()}`);
    await store.saveLecture({id:'audio',audioUsage:{requests:0,limit:2}});
    await store.putChunk({lectureId:'audio',index:0,blob:new Blob(['audio'])});
    let calls=0;
    const queue=new Queue({store:{...store,updateLecture:async()=>{throw new Error('full');}},transcribe:async()=>{calls++;return {text:'text'};}});
    await assert.rejects(queue.drain('audio'),{kind:'storage'});
    assert.equal(calls,0);
    await store.saveLecture({id:'live'});
    await store.putChunk({lectureId:'live',index:0,blob:new Blob(['live'])});
    const live=new Queue({store,transcribe:async()=>{calls++;throw Object.assign(new Error('auth'),{kind:'auth'});}});
    await assert.rejects(live.drain('live'),{kind:'auth'});
    await assert.rejects(live.retry('live'),{kind:'auth'});
    assert.equal(calls,2);
    assert.equal((await store.getLecture('live')).audioUsage,undefined);
    await store.close();
});

test('session records upload allowance only for uploads and validates imported counts', async () => {
    const store=createLectureStore(`audio-session-${crypto.randomUUID()}`);
    const queue=new Queue({store,transcribe:async()=>({text:'test'})});
    const session=new Session({store,queue,upload:async()=>({durationMs:1000})});
    const id=await session.upload(new File(['audio'],'lecture.mp3',{type:'audio/mpeg'}),{transcriptionRequestLimit:9});
    assert.deepEqual((await store.getLecture(id)).audioUsage,{requests:0,limit:9});
    // The live draft ignores an upload-only option even if a caller supplies it.
    await session.draft({id:'live',options:{transcriptionRequestLimit:9},controller:new AbortController()});
    assert.equal((await store.getLecture('live')).audioUsage,undefined);
    for (const value of [null,{requests:2,limit:1},{requests:0,limit:0},{requests:-1,limit:2},{requests:0,limit:Infinity}]) assert.throws(()=>validateAudioUsage(value));
    await store.close();
});
