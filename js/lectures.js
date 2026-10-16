import * as store from './store.js';
import { createBackup, parseBackup } from './schema.js';
export async function createLecture({id = crypto.randomUUID(), title = 'Lecture Analysis', language = 'en', providerSelections} = {}) {
    return store.saveLecture({id, title, language, providerSelections, status: 'recording', analysisStatus: 'pending', createdAt: new Date().toISOString(), transcript: ''});
}
export async function exportLibraryData() {
    if ((await store.getUnreadableLectures()).length) throw new Error('Some older lectures need recovery before a complete backup can be exported.');
    return createBackup(await store.getAllLectures());
}
export async function importLibraryData(value, options) { return store.importLectures(parseBackup(value), options); }
export async function openLecture(id) {
    const lecture = await store.getLecture(id);
    if (!lecture) throw new Error('Lecture not found in this browser.');
    return lecture;
}
export async function renameLecture(id, title) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) throw new TypeError('Use a title between 1 and 200 characters.');
    return store.updateLecture(id, {title: title.trim()});
}
export async function searchLectures(query = '') {
    const needle = query.trim().toLocaleLowerCase();
    return (await store.getAllLectures()).filter(l => [l.title, l.transcript, l.analysis?.summary].some(s => s?.toLocaleLowerCase().includes(needle)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function listRecoverableLectures() {
    return (await store.getAllLectures()).filter(lecture => ['recording', 'processing', 'interrupted', 'failed'].includes(lecture.status));
}
