import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as store from '../js/store.js';
import {openLecture, renameLecture, searchLectures, importLibraryData, exportLibraryData} from '../js/lectures.js';
test('saved lectures reopen, rename and search; conflicting or invalid imports are atomic', async () => {
    await store.saveLecture({id: 'library-test', title: 'Old', transcript: 'हिंदी lecture', analysis: {summary: 'Vectors'}});
    await renameLecture('library-test', 'New title');
    assert.equal((await openLecture('library-test')).title, 'New title');
    assert.equal((await searchLectures('हिंदी'))[0].id, 'library-test');
    assert.equal((await searchLectures('vectors'))[0].id, 'library-test');
    await assert.rejects(renameLecture('library-test', '  '));
    await assert.rejects(openLecture('missing'));
    const backup = await exportLibraryData();
    await assert.rejects(importLibraryData(backup));
    await importLibraryData(backup, {overwrite: true});
    assert.equal((await openLecture('library-test')).title, 'New title');
    await store.deleteLecture('library-test');
});
