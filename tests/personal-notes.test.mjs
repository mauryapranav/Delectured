import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {createLectureStore} from '../js/store.js';
import {createBackup, parseBackup} from '../js/schema.js';
import {validatePersonalNotes, validateAnnotations, personalSections, quoteOffset, personalStudyText} from '../js/personal-notes-data.js';

const annotation = {id:'a1', sectionId:'section:w2', quote:'chosen passage', occurrence:1, text:'My explanation <script>alert(1)</script>', placement:'after'};
test('personal data has strict bounds and drops unrelated fields', () => {
    assert.deepEqual(validatePersonalNotes(), []);
    assert.deepEqual(validateAnnotations(), []);
    assert.deepEqual(validatePersonalNotes([{sectionId:'overview', text:'', html:'bad'}]), [{sectionId:'overview', text:''}]);
    assert.deepEqual(validateAnnotations([{...annotation, x:999, html:'bad'}]), [annotation]);
    for (const patch of [{placement:'absolute'}, {occurrence:-1}, {occurrence:0.5}, {quote:'a'.repeat(2001)}, {text:' '}, {id:''}]) assert.throws(() => validateAnnotations([{...annotation, ...patch}]), TypeError);
    assert.throws(() => validatePersonalNotes([{sectionId:'overview', text:42}]), TypeError);
    assert.throws(() => validatePersonalNotes([{sectionId:'overview', text:'a'.repeat(100001)}]), TypeError);
    assert.throws(() => validateAnnotations([annotation, annotation]), /Duplicate/);
});
test('overrides follow content identifiers across reorder and regenerated notes', () => {
    const personal = [{sectionId:'section:w2', text:'My replacement'}, {sectionId:'overview', text:''}, {sectionId:'section:removed', text:'Keep orphan'}];
    const sections = personalSections({summary:'AI overview', sections:[{id:'w1', notes:'New first'}, {id:'w2', notes:'New second'}]}, personal);
    assert.equal(sections[0].text, '');
    assert.equal(sections[1].text, 'New first');
    assert.equal(sections[2].text, 'My replacement');
    assert.equal(personal[2].text, 'Keep orphan');
    assert.equal(personalSections({sections:[{id:'w2', notes:'Again'}]}, personal)[1].text, 'My replacement');
});
test('exact quote occurrence does not drift to another passage when absent', () => {
    assert.equal(quoteOffset('One quote. Another quote.', 'quote', 1), 19);
    assert.equal(quoteOffset('One quote.', 'quote', 1), -1);
    assert.equal(quoteOffset('Changed text', 'quote'), -1);
    assert.equal(quoteOffset('Text', ''), 0);
});
test('text exports preserve orphans and explicitly separate personal writing', () => {
    const output = personalStudyText({personalNotes:[{sectionId:'section:gone', text:'Unplaced edit'}], annotations:[annotation]});
    assert.match(output, /not AI evidence/); assert.match(output, /Unplaced edit/); assert.match(output, /chosen passage/);
    assert.equal(personalStudyText({}), '');
});
test('personal work survives regeneration, database reopen, and backup round trip', async () => {
    const store = createLectureStore('personal-notes-test');
    await store.saveLecture({id:'lecture', status:'ready', analysisStatus:'ready', analysis:{summary:'Generated'}});
    const personalNotes = [{sectionId:'overview', text:'My replacement'}];
    await store.updatePersonalStudy('lecture', {personalNotes, annotations:[annotation]});
    await store.updateLecture('lecture', {analysis:{summary:'Regenerated'}});
    await store.close();
    const saved = await store.getLecture('lecture');
    assert.equal(saved.analysis.summary, 'Regenerated');
    assert.deepEqual(saved.personalNotes, personalNotes);
    assert.deepEqual(saved.annotations, [annotation]);
    const [imported] = parseBackup(JSON.parse(JSON.stringify(createBackup([saved]))));
    assert.deepEqual(imported.personalNotes, personalNotes);
    assert.deepEqual(imported.annotations, [annotation]);
    await store.updateLecture('lecture', {status:'processing'});
    await assert.rejects(store.updatePersonalStudy('lecture', {personalNotes:[]}), /completed/i);
    assert.deepEqual((await store.getLecture('lecture')).personalNotes, personalNotes);
    await store.close();
});
test('a stale editor cannot overwrite personal work saved in another tab', async () => {
    const store = createLectureStore('personal-concurrency-test');
    await store.saveLecture({id:'lecture', status:'ready', analysisStatus:'ready', analysis:{summary:'Original'}});
    const first = [{sectionId:'overview', text:'Other tab edit'}];
    await store.updatePersonalStudy('lecture', {personalNotes:first}, {personalNotes:[], annotations:[]});
    await assert.rejects(store.updatePersonalStudy('lecture', {personalNotes:[], annotations:[annotation]}, {personalNotes:[], annotations:[]}), /another tab/);
    assert.deepEqual((await store.getLecture('lecture')).personalNotes, first);
    assert.deepEqual((await store.getLecture('lecture')).annotations ?? [], []);
    await store.close();
});
