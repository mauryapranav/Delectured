import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequestBudget,newUsage,validateUsage,withNotesLock} from '../js/request-budget.js';
import {requestJSON} from '../js/providers/http.js';
function fixture(usage=newUsage(1)) {
    let clock=1000,saved=usage;
    const options={usage,persist:async v=>{saved=structuredClone(v);},now:()=>clock,wait:async ms=>{clock+=ms;},random:()=>0,online:()=>true};
    return {options,get saved(){return saved;}};
}
test('HTTP attempts persist before sending and survive restart including retries and tokens',async()=>{
    const f=fixture();let calls=0;
    const send=async r=>{await r.beforeRequest();assert.equal(f.saved.requests,++calls);if(calls<3)throw Object.assign(new Error(),{kind:'network',status:503});await r.onUsage({prompt_tokens:50,completion_tokens:20});return 'ok';};
    assert.equal(await createRequestBudget(f.options).run({operation:'extract'},send),'ok');
    assert.equal(f.saved.requests,3);assert.equal(f.saved.retries,2);assert.equal(f.saved.inputTokens,50);
    const resumed=createRequestBudget({...f.options,usage:f.saved});
    await resumed.run({operation:'merge'},send);assert.equal(f.saved.requests,4);
});
test('exhausted allowance and storage failure send no request; permanent errors never retry',async()=>{
    for(const status of [400,401,403,404,413]){
        const f=fixture();let calls=0;
        await assert.rejects(createRequestBudget(f.options).run({},async r=>{await r.beforeRequest();calls++;throw Object.assign(new Error(),{kind:'response',status});}));assert.equal(calls,1);
    }
    const f=fixture({...newUsage(1),requests:1,limit:1});let sent=0;
    await assert.rejects(createRequestBudget(f.options).run({},async r=>{await r.beforeRequest();sent++;}),{kind:'budget'});assert.equal(sent,0);
    await assert.rejects(createRequestBudget({...fixture().options,persist:async()=>{throw Error();}}).run({},async r=>{await r.beforeRequest();sent++;}),{kind:'storage'});assert.equal(sent,0);
});
test('shared retry limit survives reload and long cooldown never sends early',async()=>{
    const f=fixture({...newUsage(1),retries:8});let sent=0;
    await assert.rejects(createRequestBudget(f.options).run({},async r=>{await r.beforeRequest();sent++;throw Object.assign(new Error(),{kind:'rate_limit',retryAfterMs:120000});}));assert.equal(sent,1);
    await assert.rejects(createRequestBudget({...f.options,usage:f.saved}).run({},async()=>{sent++;}),{kind:'rate_limit'});assert.equal(sent,1);
});
test('offline wait aborts with no request and unavailable lock does not run work',async()=>{
    const controller=new AbortController();let sent=0;
    await assert.rejects(createRequestBudget({...fixture().options,signal:controller.signal,online:()=>false,wait:async()=>controller.abort()}).run({},async()=>{sent++;}),{name:'AbortError'});assert.equal(sent,0);
    await assert.rejects(withNotesLock(()=>{sent++;},{request:async(_name,_options,work)=>work(null)}),{kind:'blocked'});assert.equal(sent,0);
});
test('usage ledger excludes arbitrary data and HTTP hook failure is not mislabeled network',async()=>{
    assert.equal(validateUsage({...newUsage(1),key:'secret'}).key,undefined);
    const old=globalThis.fetch;let sent=0;globalThis.fetch=async()=>{sent++;return new Response('{}');};
    try{await assert.rejects(requestJSON('https://example.com',{beforeRequest:async()=>{throw Object.assign(new Error(),{kind:'budget'});}}),{kind:'budget'});assert.equal(sent,0);}finally{globalThis.fetch=old;}
});
