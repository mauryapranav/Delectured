import * as store from './store.js';
import {describeIssue} from './processing-flow.js';
import {downloadText} from './exports.js';

// Functional recovery controls only; visual design stays in the final UI layer.
export function initQueueControls(queue, {beforeRetry = async () => {}, recovered = async () => {}, failed = async () => {}, settled = () => {}, exclusive = work => work(), recover = (id, {retry}) => retry ? queue.retry(id) : queue.resume(id), discard = id => queue.discard(id)} = {}) {
    const panel = document.createElement('section');
    panel.id = 'queue-recovery'; panel.hidden = true;
    const heading = document.createElement('h2'); heading.textContent = 'Saved work that needs attention';
    const list = document.createElement('div');
    panel.append(heading, list); document.querySelector('main').append(panel);
    const rows = new Map();
    let busy=false, cooldownTimer;
    function setBusy(value) {busy=value; for(const item of rows.values()) item.updateButtons();}
    async function runRecovery(id,retry,file) {
        if(busy || rows.get(id)?.retryAt > Date.now())return;
        setBusy(true);
        let accepted=false;
        try {await exclusive(async()=>{const extended=await beforeRetry(id); accepted=true; await recover(id,{retry:retry || extended===true,file}); await recovered(id,{retry});});}
        catch(error) {
            if(error.kind !== 'blocked')await failed(error,id);
            const item=rows.get(id);
            if(item)item.status.textContent=error.kind ? error.message : 'This step could not finish. Check the explanation above; saved work has not been deleted.';
        } finally {if(accepted)settled(); setBusy(false);}
    }
    function row(id) {
        if (rows.has(id)) return rows.get(id);
        const element = document.createElement('div'); element.dataset.lectureId = id;
        const label = document.createElement('p'); label.textContent = 'Saved lecture';
        void store.getLecture(id).then(lecture=>{if(lecture)label.textContent=lecture.title;}).catch(()=>{});
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        const countdown = document.createElement('p'); countdown.className='quiet';
        const exports = document.createElement('div');
        const processingButtons = [];
        const button = (text, action, processing = false) => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary-text-btn'; b.textContent = text;
            b.addEventListener('click', async () => {
                const disabled = processing ? processingButtons : [b];
                disabled.forEach(control => {control.disabled = true;});
                try {await action();} catch (error) {status.textContent = error.kind ? error.message : 'Recovery failed. Retained audio has not been removed.';}
                finally {if(processing)for(const item of rows.values())item.updateButtons();else b.disabled=false;}
            }); if (processing) processingButtons.push(b); element.append(b); return b;
        };
        const urls = [];
        function clearExports() {urls.splice(0).forEach(url => URL.revokeObjectURL(url)); exports.replaceChildren();}
        element.append(label, status,countdown);
        button('Resume saved work', () => runRecovery(id,false), true);
        button('Retry after fixing the problem', () => runRecovery(id,true), true);
        const originalInput = document.createElement('input'); originalInput.type='file'; originalInput.accept='.mp3,.m4a,.wav,.mp4'; originalInput.hidden=true;
        const originalButton = button('Choose original file to continue', () => originalInput.click(), true);
        originalButton.hidden=true;
        originalInput.addEventListener('change',()=>{const file=originalInput.files[0]; originalInput.value=''; if(file)void runRecovery(id,true,file);});
        element.append(originalInput);
        const saveText=button('Save transcript',async()=>{
            const lecture=await store.getLecture(id);
            if(lecture?.transcript)downloadText(lecture.transcript,'transcript.txt','text/plain;charset=utf-8');
        });
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
        const discardButton=button('Discard recording', async () => {
            if (!confirm('Delete this recording, its saved text, and retained audio?')) return;
            await discard(id); clearExports(); element.remove(); rows.delete(id); panel.hidden = !rows.size;
        });
        element.append(exports); list.append(element);
        const value = {element, label, status, clearExports, retryAt:0, updateButtons:()=>{
            for(const b of processingButtons)b.disabled=busy || value.retryAt>Date.now();
            discardButton.disabled=busy;
            const seconds=Math.max(0,Math.ceil((value.retryAt-Date.now())/1000));
            countdown.textContent=seconds?`Retry available in ${seconds} seconds.`:''; countdown.hidden=!seconds;
        }};
        value.saveText=saveText; value.originalButton=originalButton; rows.set(id, value); value.updateButtons(); panel.hidden = false; return value;
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
        clearInterval(cooldownTimer);
        for (const [id, item] of rows) {
            const saved = await store.getLecture(id);
            if (!saved || saved.status === 'ready') {item.clearExports(); item.element.remove(); rows.delete(id);}
        }
        panel.hidden = !rows.size;
        for (const lecture of await store.getAllLectures()) {
            const chunks = await store.getAllChunks(lecture.id);
            if (!chunks.some(chunk => chunk.blob) && !['recording', 'processing', 'interrupted', 'failed'].includes(lecture.status)) continue;
            const item = row(lecture.id); item.label.textContent = lecture.title;
            item.saveText.hidden=!lecture.transcript;
            item.originalButton.hidden=!lecture.uploadSource || lecture.uploadSource.complete;
            item.retryAt=lecture.processingIssue?.retryAt??0; item.updateButtons();
            const issue=lecture.processingIssue && describeIssue(lecture.processingIssue);
            item.status.textContent = issue ? `${issue.title}. ${issue.detail} ${issue.next}` : chunks.some(chunk => chunk.blob)
                ? 'Saved audio is available. Resume it, retry after fixing a problem, or export it.'
                : lecture.transcript ? 'Transcript saved. Resume to create notes without uploading or transcribing again.' : 'No completed transcript is saved. Export any retained audio before closing this tab.';
            if (lecture.uploadSource && !lecture.uploadSource.complete) item.status.textContent += ' Import is unfinished. Choose the original file to continue without repeating completed transcription.';
        }
        if([...rows.values()].some(item=>item.retryAt>Date.now()))cooldownTimer=setInterval(()=>{
            for(const item of rows.values())item.updateButtons();
            if(![...rows.values()].some(item=>item.retryAt>Date.now()))clearInterval(cooldownTimer);
        },1000);
    }
    return {refresh,setBusy,retry:id=>runRecovery(id,true)};
}
