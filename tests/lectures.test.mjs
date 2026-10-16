import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDB} from '../js/vendor/idb/index.js';
import {createLecture, exportLibraryData, importLibraryData, listRecoverableLectures} from '../js/lectures.js';
import * as store from '../js/store.js';

test('library services create recoverable drafts and refuse incomplete full backups', async () => {
    await createLecture({id: 'draft', language: 'hi-en'});
    await store.saveChunk('draft', 0, new Blob(['temporary audio']));
    assert.equal((await listRecoverableLectures())[0].language, 'hi-en');
    const backup = await exportLibraryData();
    assert.equal(backup.schemaVersion, 2);
    assert.equal(JSON.stringify(backup).includes('blob'), false);
    await assert.rejects(importLibraryData(backup), /already exists/);

    // Simulate an old malformed record without passing through the new validator.
    const raw = await openDB('DeLecturedDB');
    await raw.put('lectures', {id: 'malformed', summary: null});
    raw.close();
    assert.equal((await store.getAllLectures()).length, 1);
    await assert.rejects(exportLibraryData(), /need recovery/);
    await store.deleteLecture('malformed');
    assert.equal((await exportLibraryData()).lectures.length, 1);
});
