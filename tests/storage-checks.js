import {openDB, deleteDB} from '../js/vendor/idb/index.js';
import {createLectureStore} from '../js/store.js';
import {createBackup, parseBackup, validateLecture} from '../js/schema.js';

function check(condition, message) { if (!condition) throw new Error(message); }
async function rejects(action, message) {
    let error;
    try { await action(); } catch (caught) { error = caught; }
    check(error, message);
}

export async function runStorageChecks(report = () => {}) {
    const name = `DeLectured-test-${crypto.randomUUID()}`;
    const store = createLectureStore(name);
    const audio = new Blob(['test audio'], {type: 'audio/mpeg'});
    try {
        const legacy = await openDB(name, 1, {upgrade(db) {
            db.createObjectStore('lectures', {keyPath: 'id'});
            db.createObjectStore('chunks', {keyPath: 'id'});
        }});
        const tx = legacy.transaction(['lectures', 'chunks'], 'readwrite');
        await tx.objectStore('lectures').put({id: 'old', date: '2026-10-07T12:00:00Z', title: 'Old lecture', transcript: 'Existing text', summary: 'Existing notes'});
        await tx.objectStore('lectures').put({id: 'malformed', summary: null});
        await tx.objectStore('chunks').put({id: 'old_0', lectureId: 'old', chunkIndex: 0, status: 'transcribed', blob: audio});
        await tx.objectStore('chunks').put({id: 'orphan_0', lectureId: 'orphan', chunkIndex: 0, status: 'pending', blob: audio});
        await tx.done;
        legacy.close();
        const old = await store.getLecture('old');
        check(old.createdAt === '2026-10-07T12:00:00.000Z' && old.summary === 'Existing notes' && old.transcript === 'Existing text', 'Migration must preserve dates and notes');
        check((await store.getPendingChunks('old')).length === 1, 'Lost-text legacy chunks must retain audio for retry');
        check((await store.getLecture('orphan')).status === 'interrupted', 'Legacy unfinished audio requires a recovery draft');
        check((await store.getPendingChunks('orphan')).length === 1, 'Orphaned audio must remain recoverable');
        await store.completeChunk('old_0', {text: 'Only the retried chunk'});
        check((await store.getLecture('old')).transcript === 'Existing text', 'Partial legacy retries must not overwrite the full transcript');
        check((await store.getAllLectures()).length === 2, 'A malformed legacy record must not block valid lectures');
        check((await store.getUnreadableLectures())[0].id === 'malformed', 'Unreadable records must be reported for manual recovery');
        report('Legacy migration preserves lectures and recoverable audio');

        await store.saveLecture({id: 'live', language: 'hi-en', status: 'recording'});
        await store.putChunk({lectureId: 'live', index: 1, blob: audio, status: 'processing'});
        await store.putChunk({lectureId: 'live', index: 0, blob: audio});
        await store.completeChunk('live_1', {text: 'दूसरा section', segments: [{start: 0, end: 1, text: 'second'}]});
        await store.completeChunk('live_0', {text: 'पहला section', segments: []});
        await store.close();
        check((await store.getLecture('live')).transcript === 'पहला section\n\nदूसरा section', 'Transcript must survive reopen in capture order');
        check((await store.getAllChunks('live')).every(chunk => !chunk.blob && typeof chunk.text === 'string'), 'Success must release audio and persist text');
        await rejects(() => store.putChunk({lectureId: 'live', index: 0, blob: audio}), 'Duplicate capture must not overwrite completed text');
        check((await store.getAllChunks('live'))[0].text === 'पहला section', 'Completed text survives a rejected replacement');
        report('Transcripts survive reopen and audio is released atomically');

        await store.putChunk({lectureId: 'live', index: 2, blob: audio, status: 'processing'});
        await store.recoverLecture('live');
        check((await store.getLecture('live')).status === 'interrupted', 'Recovery must mark interruption');
        check((await store.getPendingChunks('live')).length === 1, 'Processing chunks must become retryable');
        report('Interrupted processing keeps retryable audio');

        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, ...args) {
            const request = originalPut.call(this, value, ...args);
            if (this.name === 'lectures' && value.id === 'live') {
                request.addEventListener('success', () => this.transaction.abort(), {once: true});
            }
            return request;
        };
        try {
            await rejects(() => store.completeChunk('live_2', {text: 'Must roll back'}), 'An aborted write must reject');
        } finally { IDBObjectStore.prototype.put = originalPut; }
        const pending = (await store.getAllChunks('live')).find(chunk => chunk.index === 2);
        check(pending.blob && pending.status === 'pending' && !pending.text, 'Failed commit must retain pending audio');
        check(!(await store.getLecture('live')).transcript.includes('Must roll back'), 'Failed commit must roll back lecture text');
        report('Abort after request success rejects and rolls back both records');

        const backup = createBackup(await store.getAllLectures());
        check(!JSON.stringify(backup).includes('blob'), 'Backups contain no audio');
        check(parseBackup(JSON.parse(JSON.stringify(backup))).length === 3, 'Versioned backups round-trip');
        check(parseBackup([{id: 'legacy-backup', summary: 'notes'}])[0].analysis.summary === 'notes', 'Legacy array backups remain readable');
        await rejects(() => store.importLectures([{id: 'new'}, {id: 'old'}]), 'Conflicting import must reject');
        check(!await store.getLecture('new'), 'Import conflict must roll back earlier writes');
        await rejects(() => store.importLectures([{id: 'new'}, {id: 'bad', transcript: 123}]), 'Malformed import must reject');
        check(!await store.getLecture('new'), 'Invalid import must not partially write');
        report('Backups validate fully and imports roll back on conflicts');

        await store.deleteLecture('live');
        check((await store.getAllChunks('live')).length === 0 && !await store.getLecture('live'), 'Delete must remove lecture and all audio');
        await rejects(() => store.putChunk({lectureId: 'live', index: 4, blob: audio}), 'Deleted lectures must reject late audio');
        check((await store.getAllChunks('old')).length === 1, 'Delete must leave unrelated audio alone');
        report('Deletion is scoped and late writes cannot resurrect audio');

        const normalized = validateLecture({id: 'clean', apiKey: 'secret', blob: audio, analysis: {summary: 'safe', apiKey: 'secret'}});
        check(!JSON.stringify(normalized).includes('secret') && !normalized.blob, 'Permanent format must exclude keys and audio');
        report('Permanent schema excludes credentials and audio');
    } finally {
        await store.close();
        await deleteDB(name);
    }
}
