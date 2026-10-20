import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processingIssue,describeIssue,validateProcessingIssue} from '../js/processing-flow.js';
import {validateLecture} from '../js/schema.js';
import {requestJSON} from '../js/providers/http.js';
import {runPipeline} from '../js/pipeline.js';

test('timeouts, connection failures and HTTP server errors retain distinct safe explanations',async()=>{
    const original=globalThis.fetch;
    try{
        globalThis.fetch=async()=>{throw new TypeError('private network details');};
        await assert.rejects(requestJSON('https://example.invalid',{providerId:'gemini'}),e=>{
            const issue=processingIssue(e,'notes');
            assert.equal(issue.networkReason,'connection');
            assert.match(describeIssue(issue).detail,/exact connection failure is unavailable/);return true;
        });
        globalThis.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('private timeout')),{once:true}));
        await assert.rejects(requestJSON('https://example.invalid',{providerId:'gemini',timeoutMs:5}),e=>{
            const issue=processingIssue(e,'notes');
            assert.equal(issue.networkReason,'timeout');assert.match(describeIssue(issue).detail,/timed out/);return true;
        });
        const server=processingIssue({kind:'network',status:503},'notes');
        assert.match(describeIssue(server).detail,/server error.*503/);
        assert(!describeIssue(server).detail.includes('could not be reached'));
    }finally{globalThis.fetch=original;}
});

test('merge connection failures identify the operation even without HTTP status',async()=>{
    await assert.rejects(runPipeline({transcript:{text:'First. Second.',sources:[{text:'First.'},{text:'Second.'}]}},()=>{},{
        selection:{providerId:'gemini',model:'fixture',baseUrl:'https://example.invalid'},
        complete:async r=>{
            const p=JSON.parse(r.userPrompt);
            if(p.stage==='merge')throw Object.assign(new Error('private'),{kind:'network',networkReason:'connection'});
            return JSON.stringify({notes:'Section notes',evidence:[{excerptId:p.excerpts[0].id}]});
        },
    }),e=>{
        const issue=processingIssue(e,'notes');
        assert.equal(issue.operation,'merge');assert.match(describeIssue(issue).title,/Combining section overviews/);
        assert(!JSON.stringify(issue).includes('private'));return true;
    });
});

test('processing diagnostics preserve stage and retry time without raw provider text',()=>{
    const issue=processingIssue({kind:'rate_limit',status:429,retryAfterMs:75000,message:'secret key or lecture'},'notes',1000);
    assert.equal(issue.retryAt,76000); assert.equal(issue.stage,'notes');
    const saved=validateLecture({id:'x',transcript:'Saved text',processingIssue:issue});
    assert.deepEqual(saved.processingIssue,issue);
    assert(!JSON.stringify(issue).includes('secret'));
    assert.match(describeIssue(issue).next,/countdown/);
    assert(!JSON.stringify(validateProcessingIssue({...issue,key:'secret'})).includes('secret'));
});
test('output and storage failures explain distinct next actions',()=>{
    const issue=processingIssue({kind:'study_output',message:'Evidence does not occur in its source.'},'notes');
    assert.equal(issue.reason,'evidence'); assert.match(describeIssue(issue).detail,/transcript/);
    assert.equal(processingIssue(new Error('private error'),'save').kind,'storage');
    assert.equal(processingIssue({name:'AbortError'},'notes').kind,'cancelled');
    assert.equal(processingIssue({name:'NotAllowedError'},'prepare').kind,'permission');
    assert.throws(()=>validateProcessingIssue({stage:'invalid',kind:'auth',reason:'unknown'}));
});

test('notes errors explain the failed section and persist safe retry context',()=>{
    const issue=processingIssue({kind:'study_output',message:'Evidence does not occur in its source.',section:7,totalSections:35},'notes');
    const saved=validateLecture({id:'failed',processingIssue:issue});
    const message=describeIssue(saved.processingIssue);
    assert.match(message.title,/section 7 of 35/);
    assert.match(message.detail,/AI supplied a quote/);
    assert.match(message.next,/continue from saved sections/);
    assert.match(message.next,/changing models restarts/);
    const paused=processingIssue({name:'AbortError',section:7,totalSections:35},'notes');
    assert.match(describeIssue(paused).title,/paused at section 7 of 35/);
});
