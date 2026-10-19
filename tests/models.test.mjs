import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchModels,modelsForTask,suggestedModel} from '../js/providers/models.js';
import {validateUpload,uploadLecture} from '../js/upload.js';
import {processingIssue,describeIssue} from '../js/processing-flow.js';

test('task suggestions use only listed models and exclude unrelated models',()=>{
    const models=['whisper-large-v3-turbo','openai/gpt-oss-120b','guard-model','tts-voice'].map(id=>({id}));
    assert.equal(suggestedModel(models,'groq','transcription'),'whisper-large-v3-turbo');
    assert.equal(suggestedModel(models,'groq','completion'),'openai/gpt-oss-120b');
    assert.deepEqual(modelsForTask(models,'groq','completion').map(m=>m.id),['openai/gpt-oss-120b']);
    assert.equal(suggestedModel([{id:'unknown-future-model'}],'groq','completion'),undefined);
    const gemini=['gemini-3.5-flash-lite','gemini-3.6-flash','gemini-4-pro-preview','gemini-9-image'].map(id=>({id,methods:['generateContent']}));
    assert.equal(suggestedModel(gemini,'gemini','completion'),'gemini-3.6-flash');
});
test('Gemini listing paginates, uses key header not URL, and normalizes IDs',async()=>{
    const original=globalThis.fetch;let calls=0;
    try {
        globalThis.fetch=async(url,options)=>{
            calls++;assert.equal(options.method,'GET');assert.equal(options.headers['x-goog-api-key'],'fixture-key');
            assert(!url.includes('fixture-key'));assert.equal(options.redirect,'error');
            if(calls===1)return Response.json({models:[{name:'models/gemini-3.5-flash-lite',supportedGenerationMethods:['generateContent']}],nextPageToken:'next'});
            assert(new URL(url).searchParams.get('pageToken')==='next');return Response.json({models:[{name:'models/embed',supportedGenerationMethods:['embedContent']}]});
        };
        const models=await fetchModels({providerId:'gemini',key:'fixture-key'});
        assert.equal(models.length,2);assert.equal(modelsForTask(models,'gemini','completion').length,1);
    } finally {globalThis.fetch=original;}
});
test('model lookup rejects missing keys, unsafe endpoints and redacts provider errors',async()=>{
    await assert.rejects(fetchModels({providerId:'groq',key:''}),{kind:'auth'});
    await assert.rejects(fetchModels({providerId:'compatible',key:'fixture',baseUrl:'http://remote.example'}),/HTTPS/);
    const original=globalThis.fetch;
    try {
        globalThis.fetch=async()=>Response.json({error:{message:'private-provider-body'}},{status:401});
        await assert.rejects(fetchModels({providerId:'groq',key:'fixture'}),e=>e.kind==='auth'&&!e.message.includes('private-provider-body'));
    } finally {globalThis.fetch=original;}
});
test('file failures retain actionable safe categories through the error panel',async()=>{
    try{validateUpload(new File(['x'],'lecture.txt'));assert.fail();}catch(e){
        const issue=processingIssue(e,'prepare');assert.equal(issue.reason,'file_format');assert.match(describeIssue(issue).next,/MP3/);
    }
    await assert.rejects(uploadLecture(new File(['x'],'lecture.wav'),{resample:async p=>p,open:async()=>{throw new Error('private data');}}),e=>{
        const issue=processingIssue(e,'prepare');assert.equal(issue.reason,'decode');assert(!JSON.stringify(issue).includes('private'));return true;
    });
});
