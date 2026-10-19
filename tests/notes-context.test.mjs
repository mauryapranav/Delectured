import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPipeline, splitSources} from '../js/pipeline.js';
import {chatCompletion} from '../js/providers/openai-compatible.js';
import {requestJSON} from '../js/providers/http.js';
import {processingIssue, describeIssue, validateProcessingIssue} from '../js/processing-flow.js';
const selection={providerId:'gemini',model:'fixture',baseUrl:'https://example.invalid',key:'private-key'};
const packet=source=>({notes:source.text.slice(0,80),evidence:[{sourceId:source.id,quote:source.text.slice(0,80)}],topics:[],concepts:[],flashcards:[],examSignals:[],links:[]});
test('neighbour context crosses source boundaries, survives repair, and cannot be cited as current evidence',async()=>{
    const sources=[{text:'Self attention is introduced here.'},{text:'This reduces its computational cost.'},{text:'The following topic is training.'}];
    let attempts=0;
    const result=await runPipeline({transcript:{text:sources.map(s=>s.text).join(' '),sources}},()=>{},{selection,complete:async r=>{
        const p=JSON.parse(r.userPrompt);
        if(p.stage==='merge')return JSON.stringify({summary:'Overview'});
        const value=packet(p.source);
        if(p.source.id==='w1'){
            assert.equal(p.context.before,sources[0].text);assert.equal(p.context.after,sources[2].text);
            if(++attempts===1)value.evidence=[{sourceId:'w1',quote:sources[0].text}];
            else value.evidence=[{excerptId:p.excerpts[0].id}];
        }
        return JSON.stringify(value);
    }});
    assert.equal(attempts,2);assert.equal(result.sections.length,3);
    assert.equal(result.sections[1].evidence[0].quote,sources[1].text);
});
test('sentence boundary splitting preserves all source text',()=>{
    const text='a'.repeat(3000)+'. Next sentence '+ 'b'.repeat(2500);
    const windows=splitSources([{text}]);
    assert.equal(windows[0].text,'a'.repeat(3000)+'. ');
    assert.equal(windows.map(w=>w.text).join(''),text);
});
test('explicit Gemini schema rejection falls back once and safe diagnostics survive storage',async()=>{
    const original=globalThis.fetch;const bodies=[];
    try{
        globalThis.fetch=async(url,o)=>{bodies.push(JSON.parse(o.body));return Response.json({error:{message:'Invalid response_format schema private-key private-lecture'}},{status:400});};
        await assert.rejects(chatCompletion({...selection,jsonMode:true,systemPrompt:'notes',userPrompt:'private-lecture',outputSchema:{type:'object'}},{structuredOutput:true}),e=>{
            const issue=validateProcessingIssue(processingIssue(e,'notes'));
            assert.equal(issue.rejection,'schema');assert.equal(issue.schemaFallback,true);assert.equal(issue.responseFormat,'json_object');
            assert(issue.requestBytes>0);assert(!JSON.stringify(issue).includes('private'));
            assert.match(describeIssue(issue).diagnostic,/fallback also failed/);return true;
        });
        assert.deepEqual(bodies.map(b=>b.response_format.type),['json_schema','json_object']);
        let calls=0;
        globalThis.fetch=async()=>++calls===1 ? Response.json({error:{message:'Invalid response_format schema'}},{status:400}) : Response.json({choices:[{finish_reason:'stop',message:{content:'{"summary":"ok"}'}}]});
        assert.equal(await chatCompletion({...selection,jsonMode:true,systemPrompt:'notes',userPrompt:'source',outputSchema:{type:'object'}},{structuredOutput:true}),'{"summary":"ok"}');
        assert.equal(calls,2);
    }finally{globalThis.fetch=original;}
});
test('unknown 400 does not retry; structured retry timing is retained without raw text',async()=>{
    const original=globalThis.fetch;let calls=0;
    try{
        globalThis.fetch=async()=>{calls++;return Response.json({error:{message:'private-key private-lecture'}},{status:400});};
        await assert.rejects(chatCompletion({...selection,jsonMode:true,systemPrompt:'notes',userPrompt:'source',outputSchema:{type:'object'}},{structuredOutput:true}));
        assert.equal(calls,1);
        globalThis.fetch=async()=>Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'30s'}]}},{status:429});
        await assert.rejects(requestJSON('https://example.invalid',{providerId:'gemini'}),e=>e.retryAfterMs===30000&&e.kind==='rate_limit');
    }finally{globalThis.fetch=original;}
});
test('HTTP 400 invalid keys retain access guidance without claiming a transcript exists',()=>{
    const text=describeIssue(processingIssue({kind:'auth',status:400,providerId:'gemini'},'transcribe'));
    assert.match(text.next,/key and model access/);
    assert(!text.next.includes('transcript is retained'));
});
