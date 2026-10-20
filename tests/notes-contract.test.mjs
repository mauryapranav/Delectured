import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPipeline} from '../js/pipeline.js';
import {acceptGeneratedPacket, validatePacket, validateCheckpoint} from '../js/analysis-schema.js';
import {parseStudyJSON} from '../js/study-json.js';
import {normalizeText} from '../js/providers/http.js';
import {processingIssue, describeIssue} from '../js/processing-flow.js';
import {createLectureStore} from '../js/store.js';
import {evidenceChoices} from '../js/evidence-repair.js';
const source={id:'w0',text:'One fact. Two facts. Three facts. Four facts. Five facts.'};
const evidence=source.text.match(/[^.]+\./g).map(s=>({sourceId:'w0',quote:s.trim()}));
const core={notes:'Five facts are discussed.',evidence};
const selection={providerId:'gemini',model:'fixture',baseUrl:'https://example.invalid'};

test('omission bookkeeping cannot cross the expanded-source budget',()=>{
    const text=Array.from({length:300},(_,i)=>`Fact ${i} is here. `).join('').slice(0,4900);
    const refs=evidenceChoices({text}).map(e=>({sourceId:'w0',quote:e.quote}));
    const value={notes:'n'.repeat(1996),evidence:refs,topics:[],concepts:[{term:'a',definition:'a',evidence:refs},{term:'b',definition:'b',evidence:refs.slice(0,2)}],flashcards:[{q:'a',a:'a',evidence:refs}],examSignals:[],links:[]};
    validatePacket(value,[{id:'w0',text}]);delete value.links;
    const accepted=acceptGeneratedPacket(value,[{id:'w0',text}]);
    assert.deepEqual(accepted.omitted,['links']);
    assert.equal(accepted.flashcards.length,1);
});

test('14 references and every available excerpt survive generation, expansion and persisted checkpoints',async()=>{
    const text=Array.from({length:300},(_,i)=>`Fact ${i} is here. `).join('').slice(0,4900);
    for(const count of [14,Infinity]){
        const store=createLectureStore(crypto.randomUUID());await store.saveLecture({id:'many-refs',transcript:text});
        let expected;
        const result=await runPipeline(text,()=>{},{selection,complete:async r=>{
            const p=JSON.parse(r.userPrompt);
            expected=Math.min(count,p.excerpts.length);
            assert(expected>=14);
            assert.equal(r.outputSchema.properties.evidence.maxItems,p.excerpts.length);
            return JSON.stringify({notes:'n'.repeat(1800),evidence:p.excerpts.slice(0,count).map(e=>({excerptId:e.id})),topics:[],concepts:[],flashcards:[],examSignals:[],links:[]});
        },onCheckpoint:async(c,analysis)=>store.updateLecture('many-refs',{analysisCheckpoint:c,analysis})});
        assert.equal(result.sections[0].evidence.length,expected);
        if(count===Infinity)assert(new TextEncoder().encode(JSON.stringify(result.sections[0])).length>5000);
        await store.close();
        const saved=await store.getLecture('many-refs');
        assert.equal(validateCheckpoint(saved.analysisCheckpoint).maps[0].packet.evidence.length,expected);
        assert(saved.analysis.sections[0].evidence.every(ref=>text.includes(ref.quote)));
        await store.close();
    }
});

test('five verified references survive; duplicates removed; invented and excessive evidence still rejected',()=>{
    const result=acceptGeneratedPacket({...core,evidence:[...evidence,evidence[0]]},[source]);
    assert.equal(result.evidence.length,5);
    assert.equal(validatePacket(result,[source]).evidence.length,5);
    assert.throws(()=>acceptGeneratedPacket({...core,evidence:[...evidence,{sourceId:'w0',quote:'Invented.'}]},[source]),/Evidence/);
    assert.throws(()=>acceptGeneratedPacket({...core,evidence:Array.from({length:5001},(_,i)=>({sourceId:'w0',quote:`invalid${i}`}))},[source]),e=>e.validationIssue?.code==='too_many');
});

test('local omission metadata cannot invalidate notes at the generated content limit',()=>{
    const refs=Array.from({length:12},(_,i)=>({sourceId:'w0',quote:`${i}:`+'x'.repeat(158)}));
    const src={id:'w0',text:refs.map(r=>r.quote).join(' ')};
    const value={notes:'',evidence:refs,topics:Array.from({length:8},()=> 't'.repeat(100)),concepts:[],flashcards:[],examSignals:[],links:[]};
    const emptyBytes=new TextEncoder().encode(JSON.stringify(value)).length;
    value.notes='n'.repeat(4981-emptyBytes);
    assert(value.notes.length>0 && value.notes.length<=2000);
    assert.equal(new TextEncoder().encode(JSON.stringify(value)).length,4981);
    delete value.links;
    const result=acceptGeneratedPacket(value,[src]);
    assert.deepEqual(result.omitted,['links']);assert.equal(result.notes,value.notes);
});

test('broken optional content cannot block core; warnings and omissions survive storage and checkpoints',async()=>{
    const store=createLectureStore(crypto.randomUUID());await store.saveLecture({id:'contract'});
    let requests=0;
    const result=await runPipeline(source.text,()=>{},{selection,
        complete:async r=>{
            requests++;const p=JSON.parse(r.userPrompt);
            assert(p.excerpts?.length);assert.match(r.systemPrompt,/ONE JSON object/);
            assert(!r.systemPrompt.includes('matching the schema'));
            return JSON.stringify({...core,evidence:[{excerptId:p.excerpts[0].id}],topics:['Facts'],
                concepts:[{term:'Fact',definition:'A statement.',evidence:[{excerptId:p.excerpts[0].id}]}],
                flashcards:[{q:'Invalid card',a:'Unsupported',evidence:[{excerptId:'missing'}]}],
                examSignals:[],links:[{from:'Fact',to:'Unknown',relation:'invalid',evidence:[{excerptId:p.excerpts[0].id}]}]});
        },onCheckpoint:async(c,analysis)=>{assert.deepEqual(validateCheckpoint(c).maps[0].packet.omitted,['flashcards','links']);await store.updateLecture('contract',{analysisCheckpoint:c,analysis});}});
    assert.equal(requests,1);assert.equal(result.concepts.length,1);assert.equal(result.flashcards.length,0);assert.equal(result.conceptGraph.edges.length,0);
    assert(result.warnings.some(s=>s.includes('flashcards, links')));
    await store.close();const saved=await store.getLecture('contract');
    assert.deepEqual(saved.analysis.sections[0].omitted,['flashcards','links']);await store.close();
});

test('complete outer JSON fence is accepted; malformed content and wrong roots remain distinct',()=>{
    assert.deepEqual(parseStudyJSON('```json\n{"notes":"ok"}\n```'),{notes:'ok'});
    assert.equal(normalizeText('```json\n{"notes":"ok"}\n```',{jsonMode:true}),'{"notes":"ok"}');
    for(const [text,code] of [['[]','wrong_root'],['{"notes":','malformed_json'],['Intro\n{"notes":"ok"}','malformed_json'],['','empty_json']]){
        assert.throws(()=>parseStudyJSON(text),e=>e.outputIssue===code&&!e.message.includes(text || 'secret'));
    }
});

test('repair keeps the same numbered contract and records both failure types safely',async()=>{
    let calls=0;
    await assert.rejects(runPipeline(source.text,()=>{},{selection,complete:async r=>{
        assert(JSON.parse(r.userPrompt).excerpts);
        return ++calls===1?'[]':'{"secret":';
    }}),e=>{
        const issue=processingIssue(e,'notes');
        assert.equal(issue.firstOutputIssue,'wrong_root');assert.equal(issue.outputIssue,'malformed_json');assert.equal(issue.outputAttempt,2);
        assert.match(describeIssue(issue).detail,/broken JSON/);assert(!JSON.stringify(issue).includes('secret'));return true;
    });
    assert.equal(calls,2);
});
