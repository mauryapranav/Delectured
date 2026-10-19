import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processingIssue,describeIssue,validateProcessingIssue} from '../js/processing-flow.js';
import {validateLecture} from '../js/schema.js';

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
