// Durable, key-free accounting. Count attempts before sending: a response can
// be lost even when the provider has charged for it.
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
export function validateUsage(value) {
    if (!value || !['requests','limit','retries','retryLimit','inputTokens','outputTokens'].every(k=>count(value[k])) || value.requests>value.limit || value.retries>value.retryLimit || !Number.isFinite(value.retryAt) || value.retryAt<0) throw new TypeError('Invalid request usage.');
    const events=(value.events??[]).slice(-60).map(e=>{
        if(!e || !Number.isSafeInteger(e.at)||e.at<0 || !['extract','merge','notes'].includes(e.operation) || !['sent','received','retry'].includes(e.state))throw new TypeError('Invalid usage event.');
        return {at:e.at,operation:e.operation,state:e.state};
    });
    return Object.fromEntries([...['requests','limit','retries','retryLimit','inputTokens','outputTokens'].map(k=>[k,value[k]]),['retryAt',Math.min(value.retryAt,Date.now()+86400000)],['events',events]]);
}
export function estimateNotesUsage(sections) {
    const baseline=Math.max(1,sections*2-1);
    return {baseline,limit:Math.min(1000000,baseline+Math.min(20,Math.max(4,sections))+8),retryLimit:8};
}
export function newUsage(sections) {return {...estimateNotesUsage(sections),requests:0,retries:0,inputTokens:0,outputTokens:0,retryAt:0,events:[]};}
export const budgetError = () => Object.assign(new Error('The notes request allowance has been reached. Review usage before allowing more requests.'),{kind:'budget'});
export async function pause(ms,signal) {
    signal?.throwIfAborted();
    await new Promise((resolve,reject)=>{
        const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(new DOMException('Cancelled.','AbortError'));};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
        signal?.addEventListener('abort',cancel,{once:true});
    });
}
export function createRequestBudget({usage,persist,progress=()=>{},signal,now=Date.now,wait=pause,random=Math.random,online=()=>globalThis.navigator?.onLine!==false}) {
    let state=validateUsage(usage);
    const save=async patch=>{
        const next=validateUsage({...state,...patch});
        try{await persist(next);}catch{throw Object.assign(new Error('Could not save API usage. No further requests were sent.'),{kind:'storage'});}
        state=next;
    };
    const event=(operation,status)=>[...state.events,{at:now(),operation:['extract','merge'].includes(operation)?operation:'notes',state:status}].slice(-60);
    async function ready() {
        while(!online()){signal?.throwIfAborted();progress('Offline. Requests are paused; saved notes are safe.');await wait(1000,signal);}
        const remaining=state.retryAt-now();
        if(remaining>60000)throw Object.assign(new Error('The provider cooldown is still active.'),{kind:'rate_limit',retryAfterMs:remaining});
        while(state.retryAt>now()) {
            signal?.throwIfAborted();progress(`Provider retry scheduled in ${Math.ceil((state.retryAt-now())/1000)} seconds. ${state.requests}/${state.limit} notes requests used.`);
            await wait(Math.min(1000,state.retryAt-now()),signal);
        }
        while(!online()){signal?.throwIfAborted();progress('Offline. Requests are paused; saved notes are safe.');await wait(1000,signal);}
    }
    return {
        get usage(){return structuredClone(state);},
        async run(request,send) {
            let attempt=0;
            for(;;) {
                signal?.throwIfAborted();await ready();signal?.throwIfAborted();
                let counted=false;
                const beforeRequest=async()=>{
                    signal?.throwIfAborted();
                    if(state.requests>=state.limit)throw budgetError();
                    await save({requests:state.requests+1,events:event(request.operation,'sent')});counted=true;
                    progress(`Using notes request ${state.requests} of ${state.limit}. Completed sections remain saved.`);
                };
                const onUsage=async value=>{
                    const input=value?.prompt_tokens??value?.input_tokens, output=value?.completion_tokens??value?.output_tokens;
                    const add=(a,b)=>Math.min(1000000,a+(count(b)?b:0));
                    await save({inputTokens:add(state.inputTokens,input),outputTokens:add(state.outputTokens,output),events:event(request.operation,'received'),retryAt:0});
                };
                try{return await send({...request,beforeRequest,onUsage,signal});}
                catch(error) {
                    signal?.throwIfAborted();
                    // Do not retry application/storage/credential failures, or
                    // HTTP errors that a changed request must resolve.
                    const transient=error.kind==='rate_limit' || error.kind==='network' && (!error.status || [500,502,503,504].includes(error.status));
                    if(!counted || !transient)throw error;
                    const delay=Math.max(Number.isFinite(error.retryAfterMs)?error.retryAfterMs:0,Math.round(2000*2**attempt*(1+random())));
                    await save({retryAt:now()+delay});
                    if(attempt>=2 || state.retries>=state.retryLimit || state.requests>=state.limit || delay>60000)throw error;
                    await save({retries:state.retries+1,events:event(request.operation,'retry')});attempt++;
                }
            }
        },
    };
}

// Fail closed if coordination is unavailable; a best-effort localStorage lock
// can race and cause duplicate paid work.
export async function withNotesLock(work,locks=globalThis.navigator?.locks) {
    if(!locks?.request)throw Object.assign(new Error('This browser cannot coordinate API work safely. Use a current browser.'),{kind:'blocked'});
    return locks.request('delectured-notes-job',{ifAvailable:true},lock=>{
        if(!lock)throw Object.assign(new Error('Notes are already processing in another tab. Return to that tab or pause it first.'),{kind:'blocked'});
        return work();
    });
}
