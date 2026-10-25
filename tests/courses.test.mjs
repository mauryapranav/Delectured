import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestCourseGroups,validateCourseMemberships,validateRevisionProgress,recallKey,courseRecall} from '../js/courses.js';
import {createLectureStore} from '../js/store.js';
import {createBackup,parseBackup} from '../js/schema.js';
const lecture=(id,title,terms)=>({id,title,status:'ready',analysis:{summary:terms.join(' '),concepts:terms.map(term=>({term,definition:term})),flashcards:[{q:'Explain '+title,a:'Saved answer'}]}});
const fixtures=[lecture('a','Database normalization',['relational database','normal forms']),lecture('b','Relational database design',['relational database','normal forms']),lecture('c','Organic reactions',['carbon bonds','chemical reaction'])];
test('local suggestions require three ready lectures, shared strong terms, and never assign membership',()=>{
    assert.deepEqual(suggestCourseGroups(fixtures.slice(0,2)),[]);
    assert.deepEqual(suggestCourseGroups(fixtures).map(g=>g.lectureIds),[['a','b']]);
    assert.equal(fixtures[0].courseMemberships,undefined);
    assert.deepEqual(suggestCourseGroups([lecture('1','Introduction to learning',['trees']),lecture('2','Introduction to learning',['enzymes']),lecture('3','Introduction to learning',['poems'])]),[]);
});
test('strict course and progress metadata validation',()=>{
    assert.throws(()=>validateCourseMemberships([{id:'x',title:'Course'},{id:'x',title:'Other'}]));
    assert.throws(()=>validateCourseMemberships([{id:'x',title:''}]));
    assert.throws(()=>validateRevisionProgress([{key:'x',rating:'excellent'}]));
    assert.throws(()=>validateRevisionProgress(Array.from({length:1001},(_,i)=>({key:String(i),rating:'practice'}))));
    assert.notEqual(recallKey({q:'a',a:'b'}),recallKey({q:'a',a:'changed'}));
    assert.ok(recallKey({q:'x'.repeat(10000),a:'a'}).length<100);
});
test('atomic membership edits preserve analysis, other courses, and backups; invalid selection rolls back',async()=>{
    const store=createLectureStore('courses-'+crypto.randomUUID());
    try {
        for(const l of fixtures)await store.saveLecture(l);
        await store.saveCourse({id:'other',title:'Other',lectureIds:['a']});
        await store.saveCourse({id:'db',title:'Databases',lectureIds:['a','b']});
        await assert.rejects(store.saveCourse({id:'db',title:'Broken',lectureIds:['a','missing']}));
        assert.equal((await store.getLecture('a')).courseMemberships.find(m=>m.id==='db').title,'Databases');
        await store.saveCourse({id:'db',title:'Database systems',lectureIds:['b','c']});
        assert.deepEqual((await store.getLecture('a')).courseMemberships,[{id:'other',title:'Other'}]);
        assert.equal((await store.getLecture('b')).courseMemberships[0].title,'Database systems');
        const cards=courseRecall(await store.getAllLectures(),['b']);
        await Promise.all([store.rateRecall('b',cards[0].key,'practice'),store.saveCourse({id:'new',title:'New',lectureIds:['b']})]);
        const saved=await store.getLecture('b');
        assert.equal(saved.revisionProgress[0].rating,'practice');
        assert.equal(saved.courseMemberships.length,2);
        assert.equal(saved.analysis.flashcards[0].q,fixtures[1].analysis.flashcards[0].q);
        assert.deepEqual(parseBackup(createBackup([saved]))[0].revisionProgress,saved.revisionProgress);
        await assert.rejects(store.rateRecall('b','stale-key','got-it'));
        await store.deleteCourse('db');
        assert.deepEqual((await store.getLecture('c')).courseMemberships,[]);
        assert.equal((await store.getLecture('b')).courseMemberships[0].id,'new');
    } finally {await store.close();}
});
