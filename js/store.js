
import { openDB } from './vendor/idb/index.js';
import { validateLecture, validateChunk, validateSegments } from './schema.js';
import {throwIfAborted} from './providers/http.js';

/** All mutations settle after commit. Never await network requests inside a transaction. */
export function createLectureStore(name = 'DeLecturedDB') {
    let dbPromise;
    async function getDB() {
        if (!dbPromise) {
            dbPromise = openDB(name, 2, {
                upgrade(db, oldVersion, newVersion, tx) {
                    const lectures = oldVersion < 1 ? db.createObjectStore('lectures', {keyPath: 'id'}) : tx.objectStore('lectures');
                    const chunks = oldVersion < 1 ? db.createObjectStore('chunks', {keyPath: 'id'}) : tx.objectStore('chunks');
                    lectures.createIndex('createdAt', 'createdAt');
                    lectures.createIndex('status', 'status');
                    chunks.createIndex('lectureId', 'lectureId');
                    migrate(lectures, value => validateLecture(value));
                    migrate(chunks, async value => {
                        // v1 marked chunks transcribed without saving their text; retry saved audio.
                        if (value.status === 'transcribed' && typeof value.text !== 'string') value = {...value, status: 'pending'};
                        const chunk = validateChunk(value);
                        // v1 did not create lecture drafts, so unfinished audio can be orphaned.
                        if (!await lectures.get(chunk.lectureId)) {
                            await lectures.put(validateLecture({id: chunk.lectureId, title: 'Recovered recording',
                                status: 'interrupted', analysisStatus: 'pending'}));
                        }
                        return chunk;
                    });
                },
                blocking() { close(); },
                terminated() { dbPromise = undefined; },
            }).catch(error => { dbPromise = undefined; throw error; });
        }
        return dbPromise;
    }
    function migrate(store, transform) {
        store.openCursor().then(async function next(cursor) {
            if (!cursor) return;
            try { await cursor.update(await transform(cursor.value)); }
            catch (error) {
                if (!(error instanceof TypeError)) throw error;
                console.warn('Preserved a legacy record that needs manual recovery:', cursor.key);
            }
            await next(await cursor.continue());
        }).catch(() => {
            try { store.transaction.abort(); } catch { /* Already aborted. */ }
        });
    }
    async function close() {
        const opening = dbPromise;
        dbPromise = undefined;
        if (opening) (await opening).close();
    }
    async function write(stores, operation, signal) {
        const db = await getDB();
        throwIfAborted(signal);
        const tx = db.transaction(stores, 'readwrite');
        const cancel = () => {try {tx.abort();} catch { /* Already committed. */ }};
        signal?.addEventListener('abort', cancel, {once: true});
        const done = tx.done;
        done.catch(() => {});
        try {
            const result = await operation(tx);
            await done;
            return result;
        } catch (error) {
            try { tx.abort(); } catch { /* Already aborted or completed. */ }
            await done.catch(() => {});
            throw error;
        } finally { signal?.removeEventListener('abort', cancel); }
    }
    function readLecture(value) {
        if (!value) return value;
        const lecture = validateLecture(value);
        return {...lecture, date: lecture.createdAt, ...lecture.analysis}; // Existing renderer compatibility.
    }
    async function saveLecture(value) {
        const lecture = validateLecture(value);
        await write(['lectures'], tx => tx.store.put(lecture));
        return readLecture(lecture);
    }
    async function getLecture(id) { return readLecture(await (await getDB()).get('lectures', id)); }
    async function getAllLectures() {
        const lectures = [];
        for (const value of await (await getDB()).getAll('lectures')) {
            try { lectures.push(readLecture(value)); }
            catch (error) {
                if (!(error instanceof TypeError)) throw error;
                // Keep the raw record in IndexedDB, but don't block the usable Library.
                console.warn('Lecture requires manual recovery:', value.id);
            }
        }
        return lectures;
    }
    async function getUnreadableLectures() {
        const issues = [];
        for (const value of await (await getDB()).getAll('lectures')) {
            try { validateLecture(value); }
            catch (error) { issues.push({id: value.id, error: error.message}); }
        }
        return issues;
    }
    async function updateLecture(id, patch, {signal} = {}) {
        return write(['lectures'], async tx => {
            const current = await tx.store.get(id);
            if (!current) throw new Error('Lecture no longer exists.');
            const lecture = validateLecture({...current, ...patch, id, updatedAt: new Date().toISOString()});
            await tx.store.put(lecture);
            return readLecture(lecture);
        }, signal);
    }
    async function removeChunks(tx, lectureId) {
        let cursor = await tx.objectStore('chunks').index('lectureId').openCursor(lectureId);
        while (cursor) { await cursor.delete(); cursor = await cursor.continue(); }
    }
    async function deleteLecture(id) {
        await write(['lectures', 'chunks'], async tx => {
            await tx.objectStore('lectures').delete(id);
            await removeChunks(tx, id);
        });
    }
    async function putChunk(value, {signal} = {}) {
        const chunk = validateChunk(value);
        if (chunk.status === 'transcribed') throw new TypeError('Use completeChunk to atomically save transcription.');
        return write(['lectures', 'chunks'], async tx => {
            if (!await tx.objectStore('lectures').get(chunk.lectureId)) throw new Error('Lecture no longer exists.');
            const chunks = tx.objectStore('chunks');
            const existing = await chunks.get(chunk.id);
            if (existing?.status === 'transcribed') throw new Error('Completed chunks cannot be replaced with unfinished audio.');
            await chunks.put(chunk);
            return chunk;
        }, signal);
    }
    async function saveChunk(lectureId, chunkIndex, blob, status = 'pending') {
        return putChunk({lectureId, index: chunkIndex, blob, status});
    }
    async function getAllChunks(id) {
        return (await (await getDB()).getAllFromIndex('chunks', 'lectureId', id))
            .sort((a, b) => a.index - b.index).map(chunk => ({...chunk, chunkIndex: chunk.index}));
    }
    async function getPendingChunks(id) { return (await getAllChunks(id)).filter(chunk => chunk.status === 'pending'); }
    async function completeChunk(id, result, {signal} = {}) {
        if (typeof result.text !== 'string') throw new TypeError('Transcription must contain text.');
        const segments = validateSegments(result.segments);
        return write(['lectures', 'chunks'], async tx => {
            const chunks = tx.objectStore('chunks');
            const previous = await chunks.get(id);
            if (!previous) throw new Error('Chunk no longer exists.');
            if (previous.status === 'transcribed') return validateChunk(previous);
            const lectures = tx.objectStore('lectures');
            const lecture = await lectures.get(previous.lectureId);
            if (!lecture) throw new Error('Lecture no longer exists.');
            const chunk = validateChunk({...previous, status: 'transcribed', text: result.text, segments});
            await chunks.put(chunk);
            const all = await chunks.index('lectureId').getAll(previous.lectureId);
            all.sort((a, b) => a.index - b.index);
            const transcript = lecture.transcriptSource === 'chunks'
                ? all.filter(c => c.status === 'transcribed').map(c => c.text).join('\n\n')
                : lecture.transcript;
            await lectures.put(validateLecture({...lecture, transcript, updatedAt: new Date().toISOString()}));
            return chunk;
        }, signal);
    }
    async function deleteChunk(id) { await write(['chunks'], tx => tx.store.delete(id)); }
    async function deleteChunksForLecture(id) { await write(['chunks'], tx => removeChunks(tx, id)); }
    async function recoverLecture(id) {
        return write(['lectures', 'chunks'], async tx => {
            const lectures = tx.objectStore('lectures');
            const lecture = await lectures.get(id);
            if (!lecture) throw new Error('Lecture no longer exists.');
            const chunks = tx.objectStore('chunks');
            for (const chunk of await chunks.index('lectureId').getAll(id)) {
                if (chunk.status === 'processing') await chunks.put({...chunk, status: 'pending'});
            }
            const recovered = validateLecture({...lecture, status: 'interrupted', updatedAt: new Date().toISOString()});
            await lectures.put(recovered);
            return readLecture(recovered);
        });
    }
    async function importLectures(values, {overwrite = false} = {}) {
        const lectures = values.map(value => validateLecture(value));
        if (new Set(lectures.map(value => value.id)).size !== lectures.length) throw new TypeError('Duplicate lecture IDs.');
        await write(['lectures', 'chunks'], async tx => {
            const store = tx.objectStore('lectures');
            for (const lecture of lectures) {
                const current = await store.get(lecture.id);
                if (current && !overwrite) throw new Error(`Lecture already exists: ${lecture.id}`);
                if (current && ['recording', 'processing'].includes(current.status)) throw new Error('Cannot replace an active lecture.');
                if (current) await removeChunks(tx, lecture.id);
                await store.put(lecture);
            }
        });
    }
    return {saveLecture, getLecture, getAllLectures, getUnreadableLectures, updateLecture, deleteLecture, putChunk, saveChunk,
        getAllChunks, getPendingChunks, completeChunk, deleteChunk, deleteChunksForLecture, recoverLecture, importLectures, close};
}
const defaultStore = createLectureStore();
export const {saveLecture, getLecture, getAllLectures, getUnreadableLectures, updateLecture, deleteLecture, putChunk, saveChunk,
    getAllChunks, getPendingChunks, completeChunk, deleteChunk, deleteChunksForLecture, recoverLecture, importLectures} = defaultStore;
export async function requestPersistentStorage() {
    const storage = globalThis.navigator?.storage;
    if (!storage?.persist) return false;
    try { return await storage.persisted() || await storage.persist(); } catch { return false; }
}
export async function getStorageEstimate() {
    const storage = globalThis.navigator?.storage;
    if (!storage?.estimate) return {available: false};
    const {usage, quota} = await storage.estimate();
    return {available: true, usage, quota, remaining: Math.max(0, quota - usage)};
}
