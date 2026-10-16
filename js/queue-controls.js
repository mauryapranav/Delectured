import * as store from './store.js';

// Functional recovery controls only; visual design stays in the final UI layer.
export function initQueueControls(queue, {beforeRetry = async () => {}, recovered = async () => {}, recover = (id, {retry}) => retry ? queue.retry(id) : queue.resume(id), discard = id => queue.discard(id)} = {}) {
    const panel = document.createElement('section');
    panel.id = 'queue-recovery'; panel.hidden = true;
    const heading = document.createElement('h2'); heading.textContent = 'Unfinished recordings';
    const list = document.createElement('div');
    panel.append(heading, list); document.querySelector('main').append(panel);
    const rows = new Map();
    function row(id) {
        if (rows.has(id)) return rows.get(id);
        const element = document.createElement('div'); element.dataset.lectureId = id;
        const label = document.createElement('p'); label.textContent = id;
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        const exports = document.createElement('div');
        const processingButtons = [];
        const button = (text, action, processing = false) => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary-text-btn'; b.textContent = text;
            b.addEventListener('click', async () => {
                const disabled = processing ? processingButtons : [b];
                disabled.forEach(control => {control.disabled = true;});
                try {await action();} catch (error) {status.textContent = error.kind ? error.message : 'Recovery failed. Retained audio has not been removed.';}
                finally {disabled.forEach(control => {control.disabled = false;});}
            }); if (processing) processingButtons.push(b); element.append(b); return b;
        };
        const urls = [];
        function clearExports() {urls.splice(0).forEach(url => URL.revokeObjectURL(url)); exports.replaceChildren();}
        element.append(label, status);
        button('Resume saved work', async () => {await beforeRetry(id); await recover(id, {retry: false}); await recovered(id, {retry: false});}, true);
        button('Retry after fixing the problem', async () => {await beforeRetry(id); await recover(id, {retry: true}); await recovered(id, {retry: true});}, true);
        button('Export retained audio', async () => {
            clearExports();
            const chunks = await queue.getRetainedAudio(id);
            for (const chunk of chunks) {
                const url = URL.createObjectURL(chunk.blob); urls.push(url);
                const link = document.createElement('a'); link.href = url;
                const extension = ({'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a'})[chunk.blob.type] || 'bin';
                link.download = `recording-part-${chunk.index + 1}.${extension}`;
                link.textContent = `Save audio part ${chunk.index + 1}`;
                const line = document.createElement('p'); line.append(link); exports.append(line);
            }
            status.textContent = chunks.length ? 'Save each retained part locally. Exporting does not remove it from the queue.' : 'No retained audio remains; successful parts have already become saved text.';
        });
        button('Discard recording', async () => {
            if (!confirm('Delete this recording, its saved text, and retained audio?')) return;
            await discard(id); clearExports(); element.remove(); rows.delete(id); panel.hidden = !rows.size;
        });
        element.append(exports); list.append(element);
        const value = {element, label, status, clearExports}; rows.set(id, value); panel.hidden = false; return value;
    }
    queue.subscribe(event => {
        if (event.status === 'discarded') return;
        const item = row(event.lectureId);
        if (event.status === 'blocked') item.status.textContent = event.error.message + (event.unsaved ? ' Unsaved audio is held only in this tab and will be lost on reload or close.' : ' Saved audio remains available after reload.');
        else if (event.status === 'offline') item.status.textContent = 'Offline. Saved audio will resume when the connection returns while this page is open.';
        else if (event.status === 'waiting') item.status.textContent = `Waiting until ${new Date(event.nextAttemptAt).toLocaleTimeString()} before retrying.`;
        else if (event.status === 'complete') {item.status.textContent = 'Transcription saved. No unfinished audio remains.'; item.clearExports();}
        else item.status.textContent = `${event.completed}/${event.total} audio parts transcribed.`;
    });
    globalThis.addEventListener('beforeunload', event => {
        if (queue.hasUnsavedAudio()) {event.preventDefault(); event.returnValue = '';}
    });
    async function refresh() {
        for (const [id, item] of rows) {
            const saved = await store.getLecture(id);
            if (!saved || saved.status === 'ready') {item.clearExports(); item.element.remove(); rows.delete(id);}
        }
        panel.hidden = !rows.size;
        for (const lecture of await store.getAllLectures()) {
            const chunks = await store.getAllChunks(lecture.id);
            if (!chunks.some(chunk => chunk.blob) && !['recording', 'processing', 'interrupted', 'failed'].includes(lecture.status)) continue;
            const item = row(lecture.id); item.label.textContent = lecture.title;
            item.status.textContent = chunks.some(chunk => chunk.blob)
                ? 'Saved audio is available. Resume it, retry after fixing a problem, or export it.'
                : 'This unfinished recording has no retained audio. Resume to use saved text, or discard the draft. An unfinished part may have been lost.';
        }
    }
    return {refresh};
}
