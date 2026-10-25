import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateLecture,createBackup,parseBackup} from '../js/schema.js';
import {exportMarkdown} from '../js/exports.js';

test('personal study and course metadata survives backup without changing generated evidence',()=>{
    const lecture=validateLecture({id:'personal',status:'ready',analysisStatus:'ready',analysis:{summary:'Generated summary'},
        courseMemberships:[{id:'course',title:'Computer science'}],revisionProgress:[{key:'q1',rating:'practice'}],
        personalNotes:[{sectionId:'overview',text:'My explanation'},{sectionId:'section:old',text:'Retained old notes'}],
        annotations:[{id:'a1',sectionId:'overview',quote:'My explanation',occurrence:0,text:'Check this later',placement:'after'}]});
    const restored=parseBackup(JSON.parse(JSON.stringify(createBackup([lecture]))))[0];
    assert.deepEqual(restored,lecture);
    assert.equal(restored.analysis.summary,'Generated summary');
    const md=exportMarkdown(restored);
    assert.match(md,/Summary \(personally edited\)\nMy explanation/);
    assert.match(md,/Check this later/);assert.match(md,/Retained old notes/);
    assert.throws(()=>validateLecture({...lecture,annotations:[{...lecture.annotations[0],placement:'absolute-script'}]}));
});
