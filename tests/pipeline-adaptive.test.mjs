import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPipeline} from '../js/pipeline.js';
import {validateCheckpoint} from '../js/analysis-schema.js';
import {createLectureStore} from '../js/store.js';
import {createRequestBudget, newUsage} from '../js/request-budget.js';

const selection={providerId:'groq',model:'fixture',baseUrl:'https://api.groq.com/openai/v1'};
const sourceOf=p=>({...p.source,text:p.source.text ?? p.excerpts.map(e=>e.quote).join('')});
function valid(request) {
    const p=JSON.parse(request.userPrompt);
    if(p.stage==='merge')return JSON.stringify({summary:'A supported overview.'});
    const source=sourceOf(p);
    return JSON.stringify({notes:source.text.slice(0,100),evidence:[{sourceId:source.id,quote:source.text.slice(0,80)}],topics:['Topic'],concepts:[],flashcards:[],examSignals:[],links:[]});
}

test('adaptive children conserve source and persist before requests; saved child resumes without repeating parent',async()=>{
    const transcript='Attention combines query and key vectors. '.repeat(80);
    const store=createLectureStore(crypto.randomUUID());
    await store.saveLecture({id:'split',transcript});
    let splitSaved=false;
    const seen=[];
    await assert.rejects(runPipeline(transcript,()=>{},{selection,onCheckpoint:async(c,analysis)=>{
        if(c.splits?.length)splitSaved=true;
        await store.updateLecture('split',{analysisCheckpoint:c,analysis,analysisStatus:'partial'});
    },complete:async request=>{
        const p=JSON.parse(request.userPrompt);seen.push(p.source?.id);
        if(p.source?.id==='w0')return '{';
        assert(splitSaved);
        if(p.source?.id==='w0-1')throw Object.assign(new Error('Offline'),{kind:'network'});
        return valid(request);
    }}),{kind:'network'});
    await store.close();
    const saved=await store.getLecture('split');
    assert.deepEqual(saved.analysisCheckpoint.splits,['w0']);
    assert.deepEqual(saved.analysisCheckpoint.maps.map(m=>m.id),['w0-0']);
    assert.deepEqual(seen,['w0','w0','w0-0','w0-1']);
    const resumed=[];
    const result=await runPipeline(transcript,()=>{},{selection,checkpoint:saved.analysisCheckpoint,complete:async request=>{
        resumed.push(JSON.parse(request.userPrompt));return valid(request);
    }});
    assert.deepEqual(resumed.filter(p=>p.stage==='extract').map(p=>p.source.id),['w0-1']);
    assert.equal(result.sections.length,2);
    const second=sourceOf(resumed[0]).text;
    assert(transcript.endsWith(second));
    assert(!result.warnings.some(w=>w.includes('NaN')));
    await store.close();
});

test('splitting is bounded and never applied to HTTP rejection or fabricated evidence',async()=>{
    const transcript='A valid source sentence. '.repeat(170);let calls=0;let checkpoint;
    await assert.rejects(runPipeline(transcript,()=>{},{selection,onCheckpoint:c=>{checkpoint=c;},complete:async()=>{calls++;return '{';}}),{kind:'study_output'});
    assert.equal(calls,6); // Parent, first child, first grandchild: two attempts each.
    assert.deepEqual(checkpoint.splits,['w0','w0-0']);
    for(const status of [400,429,503]) {
        calls=0;
        await assert.rejects(runPipeline(transcript,()=>{},{selection,complete:async()=>{calls++;throw Object.assign(new Error('Rejected'),{kind:'response',status});}}),{status});
        assert.equal(calls,1);
    }
    calls=0;
    await assert.rejects(runPipeline(transcript,()=>{},{selection,complete:async r=>{calls++;const p=JSON.parse(valid(r));p.evidence=[{sourceId:'w0',quote:'Fabricated material'}];return JSON.stringify(p);}}),{kind:'study_output'});
    assert.equal(calls,2);
});

test('core-only option removes extras and keeps legacy fingerprint for the default',async()=>{
    let checkpoint;
    await runPipeline('A source sentence.',()=>{},{selection,onCheckpoint:c=>{checkpoint=c;},complete:async r=>valid(r)});
    let calls=0;
    await runPipeline({transcript:'A source sentence.',includeExtras:true},()=>{},{selection,checkpoint,complete:async r=>{calls++;return valid(r);}});
    assert.equal(calls,0);
    const core=await runPipeline({transcript:'A source sentence.',includeExtras:false},()=>{},{selection,checkpoint,complete:async r=>{calls++;assert(r.systemPrompt.includes('Core notes only'));return valid(r);}});
    assert.equal(calls,1);assert.deepEqual(core.topics,[]);
});

test('completed merge checkpoints resume only when their inputs match',async()=>{
    const transcript='The source discusses attention. '.repeat(500);let checkpoint;
    await runPipeline(transcript,()=>{},{selection,onCheckpoint:c=>{checkpoint=c;},complete:async r=>valid(r)});
    checkpoint=validateCheckpoint(checkpoint);
    let calls=0;
    await runPipeline(transcript,()=>{},{selection,checkpoint,complete:async r=>{calls++;return valid(r);}});
    assert.equal(calls,0);
    checkpoint.maps[0].packet.notes='Changed supported notes.';
    const stages=[];
    await runPipeline(transcript,()=>{},{selection,checkpoint,complete:async r=>{stages.push(JSON.parse(r.userPrompt).stage);return valid(r);}});
    assert(stages.length>0);assert(stages.every(s=>s==='merge'));
});

test('nested UTF-8 splits preserve every character and validate references after persisted resume',async()=>{
    const transcript='हिंदी में attention और 🧠 की चर्चा। '.repeat(45);
    let checkpoint;const leaves=[];
    const result=await runPipeline(transcript,()=>{},{selection,onCheckpoint:c=>{checkpoint=validateCheckpoint(c);},complete:async request=>{
        const p=JSON.parse(request.userPrompt);
        if(p.stage==='extract') {
            if(p.source.id==='w0' || p.source.id==='w0-0')return '{';
            leaves.push(sourceOf(p));
        }
        return valid(request);
    }});
    assert.deepEqual(checkpoint.splits,['w0','w0-0']);
    assert.equal(leaves.map(s=>s.text).join(''),transcript);
    for(const section of result.sections) {
        const source=leaves.find(s=>s.id===section.id);
        for(const ref of section.evidence)assert(source.text.includes(ref.quote));
    }
    await runPipeline(transcript,()=>{},{selection,checkpoint,complete:async()=>assert.fail('Completed split maps and merges must be reused')});
});

test('durable request allowance counts repair and split attempts; exhausted budget preserves split plan',async()=>{
    const transcript='Attention uses query, key and value vectors. '.repeat(70);
    let persisted;let checkpoint;let sends=0;
    const governor=createRequestBudget({usage:{...newUsage(1),limit:2},persist:async usage=>{persisted=usage;}});
    await assert.rejects(runPipeline(transcript,()=>{},{selection,onCheckpoint:c=>{checkpoint=c;},complete:request=>governor.run(request,async r=>{
        await r.beforeRequest();sends++;return '{';
    })}),{kind:'budget'});
    assert.equal(sends,2);assert.equal(persisted.requests,2);
    assert.deepEqual(checkpoint.splits,['w0']);
    assert.equal(checkpoint.maps.length,0);
    assert.deepEqual(persisted.events.map(e=>e.operation),['extract','extract']);
    const resumed=[];
    await runPipeline(transcript,()=>{},{selection,checkpoint,complete:async request=>{resumed.push(JSON.parse(request.userPrompt));return valid(request);}});
    assert.deepEqual(resumed.filter(p=>p.stage==='extract').map(p=>p.source.id),['w0-0','w0-1']);
});

test('core-only option checkpoints resume with either options or settings and invalidate when extras are requested',async()=>{
    let checkpoint;
    await runPipeline({transcript:'A supported source.',includeExtras:false},()=>{},{selection,onCheckpoint:c=>{checkpoint=validateCheckpoint(c);},complete:async r=>valid(r)});
    await runPipeline('A supported source.',()=>{},{selection,includeExtras:false,checkpoint,complete:async()=>assert.fail('Same core-only setting must reuse checkpoint')});
    let calls=0;
    await runPipeline({transcript:'A supported source.',includeExtras:true},()=>{},{selection,checkpoint,complete:async r=>{calls++;return valid(r);}});
    assert.equal(calls,1);
});

test('legacy complete maps and unhashed merges upgrade without any paid regeneration',async()=>{
    const transcript='Attention compares token representations. '.repeat(400);let checkpoint;
    await runPipeline(transcript,()=>{},{selection,onCheckpoint:c=>{checkpoint=c;},complete:async r=>valid(r)});
    for(const merge of checkpoint.merges)delete merge.inputKey;
    let upgraded;
    await runPipeline(transcript,()=>{},{selection,checkpoint,onCheckpoint:c=>{upgraded=c;},complete:async()=>assert.fail('Valid legacy overview must not cost another request')});
    assert(upgraded.merges.length>0);
    assert(upgraded.merges.every(m=>/^[a-f0-9]{64}$/.test(m.inputKey)));
    // Missing maps invalidate the old merge tree rather than trusting a stale
    // summary for newly generated notes.
    checkpoint.maps.shift();let calls=0;
    await runPipeline(transcript,()=>{},{selection,checkpoint,complete:async r=>{calls++;return valid(r);}});
    assert(calls>1);
});
