import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPipeline} from '../js/pipeline.js';
import {PACKET_OUTPUT_SCHEMA, validatePacket} from '../js/analysis-schema.js';
import {diagnosePacket,geminiStudySchema,safeValidationIssue} from '../js/study-validation.js';
import {processingIssue,describeIssue} from '../js/processing-flow.js';
import {validateLecture} from '../js/schema.js';
const packet=()=>({notes:'Attention uses vectors.',evidence:[{sourceId:'w0',quote:'Attention uses vectors.'}],topics:[],concepts:[],flashcards:[],examSignals:[],links:[]});
const selection={providerId:'gemini',model:'gemini-3.5-flash-lite',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai'};
test('local size rejection identifies exact safe field and numeric limit',()=>{
    const value=packet();value.notes='x'.repeat(2200);
    assert.deepEqual(diagnosePacket(value),{field:'notes',code:'too_long',actual:2200,limit:2000});
    assert.throws(()=>validatePacket(value),e=>e.validationIssue?.actual===2200);
    value.notes='short';value.concepts=[{term:'private lecture content',definition:42,evidence:[]}];
    assert.deepEqual(diagnosePacket(value),{field:'concepts.definition',code:'type'});
});
test('Gemini schema supplies local array limits and text guidance without unsupported maxLength',()=>{
    const schema=geminiStudySchema(PACKET_OUTPUT_SCHEMA);
    assert.equal(schema.properties.concepts.maxItems,8);
    assert.equal(schema.properties.evidence.minItems,1);
    assert.match(schema.properties.notes.description,/2000 characters/);
    assert(!JSON.stringify(schema).includes('maxLength'));
    assert.equal(PACKET_OUTPUT_SCHEMA.properties.notes.description,undefined);
});
test('overlong notes trigger a smaller numbered repair with the precise failed limit',async()=>{
    let calls=0;
    const result=await runPipeline('Attention uses vectors.',()=>{},{selection,complete:async r=>{
        calls++;const value=packet();
        if(calls===1)value.notes='x'.repeat(2200);
        else{
            assert.match(r.systemPrompt,/2200 characters/);assert.match(r.systemPrompt,/2000/);
            const payload=JSON.parse(r.userPrompt);assert(payload.excerpts);
            value.evidence=[{excerptId:payload.excerpts[0].id}];
        }
        return JSON.stringify(value);
    }});
    assert.equal(calls,2);assert.equal(result.sections.length,1);
});
test('exhausted validation persists a precise diagnosis without model text',async()=>{
    await assert.rejects(runPipeline('Attention uses vectors.',()=>{},{selection,complete:async()=>{
        const value=packet();value.notes='secret '.repeat(350);return JSON.stringify(value);
    }}),error=>{
        const issue=processingIssue(error,'notes');
        const saved=validateLecture({id:'x',processingIssue:issue});
        assert.equal(saved.processingIssue.providerId,'gemini');
        assert.match(describeIssue(saved.processingIssue).detail,/2450 characters.*2000/);
        assert(!JSON.stringify(saved.processingIssue).includes('secret'));
        return true;
    });
    assert.equal(safeValidationIssue({field:'private transcript text',code:'missing'}),undefined);
});
