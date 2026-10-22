/**
 * js/app.js
 * Main UI Orchestrator for DeLectured v3
 */
import { getConfig, setLanguage } from './config.js';
import {validateProviderConfiguration, getProviderSelection, complete} from './providers/index.js';
import {initProviderSettings} from './provider-settings.js';
import {Session} from './session.js';
import {validateUpload, uploadError} from './upload.js';
import { Queue } from './queue.js';
import {initQueueControls} from './queue-controls.js';
import {refreshNotesSelection} from './notes-recovery.js';
import {initProcessingFlow,processingIssue} from './processing-flow.js';
import {watchAppUpdates,showAppUpdate} from './app-updates.js';
import { runPipeline, splitSources } from './pipeline.js';
import {createRequestBudget,newUsage,withNotesLock} from './request-budget.js';
import {chooseUploadPlan} from './upload-plan.js';
import {assembleTranscript} from './transcript.js';
import * as store from './store.js';
import {escapeHTML} from './safe-render.js';
import {renderLecture, choosePrintLayout} from './report.js';
import {openLecture, renameLecture} from './lectures.js';
import {exportMarkdown, exportAnkiCsv, downloadText} from './exports.js';
import {askLecture} from './chat.js';
import {initShell, refreshRecent} from './shell.js';
import {initRouter} from './router.js';
import {showLibrary} from './library.js';
import {notice} from './shell.js';
import {startCaptureMeter} from './capture-meter.js';

// --- Global State ---
let currentLectureId = null;
let currentLanguage = 'en';

const queue = new Queue();
const session = new Session({queue, onState: onSessionState});
let reportController = null;
let questionController = null;
let reportActionPending = false;
let recoveryControls;
let processingFlow;
let pendingUpload=null;
let uploadPreparing=false;
let stopPromise = null;
let stopMeter = () => {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {void initializeApp().catch(showUnexpectedFailure);});
// Keep unexpected browser/startup failures visible without exposing exception text.
function showUnexpectedFailure() {
    if(document.getElementById('unexpected-failure'))return;
    const panel=document.createElement('section');panel.id='unexpected-failure';panel.className='processing-problem';panel.setAttribute('role','alert');
    const heading=document.createElement('h2');heading.textContent='The app could not finish an operation';
    const text=document.createElement('p');text.textContent='Keep this tab open. Save any available transcript or retained audio before reloading. If this happened when opening the site, try a current browser with site storage enabled. Your saved lectures have not been intentionally deleted.';
    panel.append(heading,text);(document.querySelector('main')??document.body).prepend(panel);
}
window.addEventListener('unhandledrejection',showUnexpectedFailure);
window.addEventListener('error',showUnexpectedFailure);
async function initializeApp() {
    // Source HTML does not contain the composed route shell. Do not let a
    // navigation hide every view, or initialize controls that are absent.
    if (!document.getElementById('library-section') || !document.getElementById('guide-section')) {
        const panel=document.createElement('section');panel.className='processing-problem';panel.setAttribute('role','alert');
        const heading=document.createElement('h1');heading.textContent='Open the built app to access your lectures';
        const text=document.createElement('p');text.textContent='This server opened a source page instead of the complete app. Navigation cannot work here. This does not delete browser storage.';
        const status=document.createElement('p');status.textContent='Checking saved lectures in this browser…';
        const link=document.createElement('a');link.textContent='Open the complete app';
        const target=new URL('./dist/index.html',location.href);target.search=location.search;target.hash=location.hash;link.href=target.href;
        const help=document.createElement('p');help.textContent='For local development, run npm run build first. This link keeps the same browser address and port, so it uses the same saved lectures. Do not clear site data.';
        panel.append(heading,text,status,link,help);
        document.querySelector('main').replaceChildren(panel);
        try {
            const saved=await store.getAllLectures(), unreadable=await store.getUnreadableLectures();
            status.textContent=`Found ${saved.length} readable saved lecture(s) and ${unreadable.length} saved record(s) that this version cannot read.`;
        } catch {status.textContent='Browser storage could not be read. This is not confirmation that your lectures were deleted.';}
        return;
    }
    switchView(new URL(location.href).searchParams.has('capture') ? 'input-section' : 'welcome-section');
    const busy = () => uploadPreparing || session.busy || Boolean(reportController) || reportActionPending;
    const shell = initShell({busy});
    // 2. Keys Drawer
    const settings = initKeysDrawer();
    processingFlow = initProcessingFlow({settings:settings.open,
        retry:()=>recoveryControls.retry(currentLectureId), cancel:()=>reportController?.abort(),
        exportTranscript:async()=>{
            try {const lecture=await store.getLecture(currentLectureId); if(lecture?.transcript)downloadText(lecture.transcript,'transcript.txt','text/plain;charset=utf-8');}
            catch {notice('The saved transcript could not be read. Keep this tab open.');}
        }});
    updateSetupStatus();

    // 3. Language Selector
    initLangSelector();

    // 4. Input Handlers
    document.getElementById('start-record-btn')?.addEventListener('click', startRecording);
    document.getElementById('stop-record-btn')?.addEventListener('click', () => stopRecording().catch(showProcessingError));
    document.getElementById('discard-record-btn')?.addEventListener('click', () => discardRecording().catch(showProcessingError));
    recoveryControls = initQueueControls(queue, {
        exclusive:withNotesLock,
        beforeRetry: async id => {
            if (reportController || reportActionPending) throw Object.assign(new Error('A step is already running. Wait for it to finish or pause notes generation.'), {kind: 'blocked'});
            if (session.busy && (session.active?.id !== id || session.active.state !== 'interrupted')) throw Object.assign(new Error('Stop the current session before recovery.'), {kind: 'blocked'});
            const saved=await store.getLecture(id);
            let extended=false;
            if(saved?.audioUsage && saved.audioUsage.requests>=saved.audioUsage.limit) {
                if(!confirm(`This upload has reserved ${saved.audioUsage.requests} of ${saved.audioUsage.limit} transcription attempts. Allow up to 8 more? Completed transcript sections will be reused. Provider charges may apply.`))throw Object.assign(new Error('Transcription allowance was not extended.'),{kind:'budget'});
                await store.updateLecture(id,{audioUsage:{...saved.audioUsage,limit:Math.min(1000000,saved.audioUsage.limit+8)}});
                extended=true;
            }
            reportActionPending=true;
            currentLectureId = id; switchView('recording-section');
            processingFlow.update('transcribe','Checking saved audio and transcript…');
            return extended;
        },
        recover: (id, options) => session.recover(id, options),
        recovered: (id, options) => generateFinalReportLocked(id, options),
        failed:showProcessingError,
        settled:()=>{reportActionPending=false;},
        discard: id => id === currentLectureId ? discardRecording() : queue.discard(id),
    });
    queue.subscribe(event => {
        if (event.lectureId !== currentLectureId) return;
        if (reportController) return;
        if (event.status === 'blocked') {
            showProcessingError(event.error, event.lectureId, 'transcribe'); return;
        }
        const previewId = currentLectureId;
        store.getLecture(previewId).then(saved => {if (previewId === currentLectureId && saved?.transcript) document.getElementById('live-transcript').textContent = saved.transcript;}).catch(() => {});
        const caption = document.getElementById('recording-caption');
        if (event.status === 'offline') caption.innerText = 'Waiting for connection...';
        else if (event.status === 'waiting') caption.innerText = `Retry scheduled for ${new Date(event.nextAttemptAt).toLocaleTimeString()}`;
        else {
            document.getElementById('recording-progress-rule').style.width = `${event.total ? event.completed / event.total * 100 : 0}%`;
            caption.innerText = session.active?.state === 'recording' ? 'Recording… Completed transcript sections are saved.' : 'Preparing your saved transcript…';
        }
        if(session.active?.state !== 'recording')processingFlow.update('transcribe',caption.innerText);
    });
    await recoveryControls.refresh().catch(() => {});
    
    // File upload and drop use the same session/queue lifecycle.
    document.getElementById('upload-zone')?.addEventListener('click', () => {
        document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', event => {
        const file = event.target.files[0]; event.target.value = ''; if (file) startUpload(file);
    });
    const uploadZone = document.getElementById('upload-zone');
    uploadZone.addEventListener('dragover', event => event.preventDefault());
    uploadZone.addEventListener('drop', event => {event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) startUpload(file);});

    initReportControls();
    await initRouter({prepare: async url => {
        const commit = await prepareRoute(url);
        return () => {
            questionController?.abort(); questionController = null;
            document.getElementById('sample-notice').hidden = true;
            document.getElementById('lecture-question').value = '';
            document.getElementById('lecture-answer').textContent = '';
            for (const id of ['export-md','export-csv','rename-report','regenerate-report','lecture-question']) document.getElementById(id).disabled = false;
            document.querySelectorAll('[data-export],[data-report-action],#lecture-question-form button').forEach(button => button.disabled = false);
            commit();
        };
    }, busy, changed: shell.updateRoute,
        openSettings: settings.open,
        blocked: () => notice('Finish or discard the current recording or report before opening another page.'),
        error: error => notice(error.message || 'This page could not be opened. Your current work is still available.'),
    });

    // 5. Persistent Storage Request
    await store.requestPersistentStorage();

    // 6. Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(registration => {
            watchAppUpdates(registration,navigator.serviceWorker,showAppUpdate);
        }).catch(err => {
            console.warn('Service Worker registration failed:', err);
        });
    }
}


// All route content is composed into the shared shell by the static build.
async function prepareRoute(url) {
    if (url.pathname.endsWith('library.html')) return () => {switchView('library-section'); void showLibrary(url);};
    if (url.pathname.endsWith('guide.html')) return () => switchView('guide-section');
    const savedId = url.searchParams.get('lecture');
    const demo = !savedId && url.searchParams.get('demo') === 'folio';
    const lecture = savedId ? await openLecture(savedId) : demo ? (await import('./demo-lecture.js')).folioSample() : null;
    return () => {
        if (!lecture) {switchView(url.searchParams.has('capture') ? 'input-section' : 'welcome-section'); return;}
        currentLectureId = savedId;
        renderLecture(lecture);
        switchView('result-section');
        document.getElementById('sample-notice').hidden = !demo;
        if (demo) document.getElementById('report-state').textContent = 'Sample lecture';
        for (const id of ['export-md','export-csv','rename-report','regenerate-report']) document.getElementById(id).disabled = demo;
        document.querySelectorAll('[data-export],[data-report-action]').forEach(button => {
            button.disabled = document.getElementById(button.dataset.export || button.dataset.reportAction).disabled;
        });
        document.getElementById('lecture-question').disabled = demo;
        document.getElementById('lecture-question').value = '';
        document.querySelectorAll('#question-suggestions button').forEach(button => button.disabled = demo);
        document.querySelector('#lecture-question-form button[type="submit"]').disabled = demo;
        document.getElementById('lecture-answer').textContent = demo ? 'This sample is read-only. Record a lecture to ask questions about your own transcript.' : '';
    };
}

// --- Keys Drawer ---
function initKeysDrawer() {
    const settings = initProviderSettings();
    const drawer = document.getElementById('keys-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    
    let restoreFocus;
    const open = () => {
        restoreFocus = document.activeElement; settings.load(); drawer.inert = false;
        drawer.classList.add('open'); backdrop.classList.add('open');
        drawer.style.visibility = 'visible';
        document.getElementById('close-drawer-btn').focus();
    };
    const close = () => {
        drawer.classList.remove('open'); backdrop.classList.remove('open'); drawer.inert = true;
        drawer.style.visibility = '';
        restoreFocus?.focus();
    };
    document.getElementById('keys-drawer-btn')?.addEventListener('click', open);
    document.getElementById('mobile-settings')?.addEventListener('click', open);
    document.querySelectorAll('[data-open-settings]').forEach(button => button.addEventListener('click', open));
    document.getElementById('close-drawer-btn')?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && drawer.classList.contains('open')) {event.preventDefault(); close();}
    });
    drawer.addEventListener('keydown', event => {
        if (event.key === 'Escape') {event.preventDefault(); close();}
        if (event.key !== 'Tab') return;
        const items = [...drawer.querySelectorAll('button, input, select, a[href]')].filter(el => !el.disabled && el.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
    });


    document.getElementById('save-keys-btn')?.addEventListener('click', () => {
        try {
            settings.save();
            updateSetupStatus();
            close();
            if(pendingUpload)void startUpload(pendingUpload);
        } catch (error) {
            alert(`Your settings could not be saved: ${error.message}`);
        }
    });
    return {open, close};
}

function updateSetupStatus() {
    const config = getConfig();
    const configured = [config.transcriptionProvider, config.notesProvider].every(provider => config.keys[provider]?.trim());
    document.getElementById('setup-status').textContent = configured
        ? 'Keys saved for your selected providers · Provider access has not been verified.'
        : 'First visit? Add a key for each selected provider in Settings.';
}

// --- Language Selector ---
function initLangSelector() {
    const btns = document.querySelectorAll('.lang-text-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            btns.forEach(b => b.classList.remove('active'));
            const target = e.target;
            target.classList.add('active');
            currentLanguage = target.dataset.lang;
            setLanguage(currentLanguage);
            btns.forEach(b => b.setAttribute('aria-pressed', String(b === target)));
        });
    });
    
    const config = getConfig();
    if (config.language) {
        currentLanguage = config.language;
        btns.forEach(b => {
            if (b.dataset.lang === currentLanguage) {
                b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
            } else {
                b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
            }
        });
    }
}

// --- Recording & UI Flow ---
let recordTimerInterval = null;
let recordStartTime = 0;


function switchView(viewId) {
    ['welcome-section', 'input-section', 'recording-section', 'result-section', 'library-section', 'guide-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === viewId) {
                el.classList.remove('hidden-view');
                el.classList.add('active-view');
            } else {
                el.classList.add('hidden-view');
                el.classList.remove('active-view');
            }
        }
    });
}

function providerOptions() {
    return {language: currentLanguage, providerSelections: {
        transcription: validateProviderConfiguration('transcription'), completion: validateProviderConfiguration('completion'),
    }};
}
function onSessionState(event) {
    if (event.state === 'starting') {currentLectureId = event.id; document.getElementById('record-timer').textContent = '00:00:00'; document.getElementById('live-transcript').textContent = 'Waiting for the first completed section.'; switchView('recording-section');}
    if (event.id !== currentLectureId) return;
    const caption = document.getElementById('recording-caption');
    if (event.state === 'upload-progress') {
        const action = {prepare:'Preparing',compress:'Compressing',transcribe:'Transcribing'}[event.phase];
        caption.textContent = event.phase === 'verify' ? `Checking the original file: ${Math.round(event.fraction * 100)}%.`
            : `${action} part ${Math.min(event.index + 1,event.total)} of ${event.total}. Keep this tab open; completed sections are saved.`;
        processingFlow?.update(event.phase === 'transcribe' ? 'transcribe' : 'prepare',caption.textContent);
        return;
    }
    if (event.state === 'recording') {
        stopMeter(); stopMeter = startCaptureMeter(session.active?.recorder, document.getElementById('record-canvas'));
        recordStartTime = Date.now(); clearInterval(recordTimerInterval);
        recordTimerInterval = setInterval(updateTimer, 1000); caption.innerText = 'Recording...';
    } else {
        stopMeter();
        clearInterval(recordTimerInterval);
        const labels = {starting: 'Starting...', uploading: 'Reading and preparing audio...', stopping: 'Saving the final audio...',
            processing: 'Transcribing saved audio...', interrupted: 'Capture interrupted. Completed audio is retained; an unknown gap is recorded.', complete: 'Transcript saved.'};
        if (labels[event.state]) caption.innerText = labels[event.state];
    }
    document.getElementById('recording-title').textContent = event.state === 'recording' ? 'Recording lecture' : ['starting','uploading'].includes(event.state) ? 'Preparing your lecture' : 'Bringing it together';
    document.getElementById('stop-record-btn').disabled = ['starting', 'uploading', 'processing', 'stopping', 'discarding'].includes(event.state);
    if(['starting','uploading','recording','stopping','processing','complete'].includes(event.state)) {
        processingFlow?.update(['starting','uploading','recording'].includes(event.state)?'prepare':'transcribe',caption.innerText,{recording:event.state==='recording'});
        recoveryControls?.setBusy(true);
    }
}
async function startRecording() {
    if (session.busy || reportController || reportActionPending || uploadPreparing) return;
    currentLectureId=null; processingFlow.update('prepare','Checking microphone and provider settings…'); switchView('recording-section');
    try {await session.start(providerOptions());}
    catch (error) {if (error.name === 'AbortError' && !currentLectureId) return; await showProcessingError(error);}
}
async function startUpload(file) {
    if(uploadPreparing)return;
    uploadPreparing=true;
    try {return await withNotesLock(()=>startUploadUnlocked(file));}
    catch(error){await showProcessingError(error);}
    finally {uploadPreparing=false;}
}
async function startUploadUnlocked(file) {
    if (session.busy || reportController || reportActionPending) {notice(file===pendingUpload?'Finish the current work first. Your queued file remains available in Settings.':'Finish the current work first, then select this file again.');return;}
    pendingUpload=null;document.getElementById('pending-upload-notice')?.remove();document.getElementById('save-keys-btn').textContent='Save settings';
    currentLectureId=null; processingFlow.update('prepare','Checking audio and provider settings…'); switchView('recording-section');
    try {
        validateUpload(file);
        let options;
        try {options=providerOptions();}
        catch(error) {
            pendingUpload=file;
            await showProcessingError(error);
            document.getElementById('keys-drawer-btn').click();
            let note=document.getElementById('pending-upload-notice');
            if(!note){note=document.createElement('p');note.id='pending-upload-notice';note.setAttribute('role','status');document.querySelector('#keys-drawer .drawer-content').prepend(note);}
            note.textContent=`${file.name}: choose providers, enter their keys and select models. Your file stays in this tab until you save settings. Nothing has been uploaded yet.`;
            const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary-text-btn';cancel.textContent='Cancel selected file';
            cancel.addEventListener('click',()=>{pendingUpload=null;note.remove();document.getElementById('save-keys-btn').textContent='Save settings';});note.append(cancel);
            document.getElementById('save-keys-btn').textContent='Save settings & process file';
            return;
        }
        pendingUpload=null;
        const plan=await chooseUploadPlan(file,await store.getAllLectures());
        if(!plan){switchView('input-section');return;}
        if(plan.existing){
            uploadPreparing=false;
            currentLectureId=plan.existing.id;
            if(plan.existing.analysisStatus==='ready'){renderLecture(await openLecture(currentLectureId));switchView('result-section');}
            else {
                const saved=plan.existing, stage=saved.uploadSource?.complete?'notes':'transcribe';
                switchView('recording-section');document.getElementById('live-transcript').textContent=saved.transcript;
                processingFlow.fail(saved.processingIssue??processingIssue(new DOMException('Paused.','AbortError'),stage),{transcriptSaved:!!saved.transcript,transcriptComplete:stage==='notes',canRetry:true});
                await recoveryControls.refresh();notice('Use Resume saved work below. Completed audio and notes will be reused.');
            }
            return;
        }
        const id = await session.upload(file, {...options,includeExtras:plan.includeExtras,transcriptionRequestLimit:Math.ceil(plan.seconds/300)+8}); uploadPreparing=false;await generateFinalReportLocked(id);
    }
    catch (error) {uploadPreparing=false;if (error.name === 'AbortError' && !currentLectureId) return; await showProcessingError(error);}
}
function updateTimer() {
    const ms = Date.now() - recordStartTime;
    document.getElementById('record-timer').innerText = [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
        .map(value => String(value).padStart(2, '0')).join(':');
}
function stopRecording() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {const id = await session.stop(); if (id === currentLectureId) await generateFinalReport(id);})()
        .finally(() => {stopPromise = null;});
    return stopPromise;
}
async function discardRecording() {
    stopMeter();
    clearInterval(recordTimerInterval);
    const id = currentLectureId; currentLectureId = null; reportController?.abort();
    if (session.active?.id === id) await session.discard(); else if (id) await queue.discard(id);
    switchView('input-section');
    recoveryControls?.setBusy(false);
}

async function generateFinalReport(lectureId = currentLectureId, options = {}) {
    return withNotesLock(()=>generateFinalReportLocked(lectureId,options));
}
async function generateFinalReportLocked(lectureId = currentLectureId, {retry = false, reset = false} = {}) {
    if (lectureId !== currentLectureId) return;
    if (reportController) throw new Error('A report is already being prepared.');
    const controller = new AbortController(); reportController = controller;
    const signal = controller.signal;
    document.getElementById('partial-notes-preview')?.remove();
    processingFlow.update('notes','Checking saved transcript and notes settings…');
    recoveryControls.setBusy(true);
    const check = () => {if (signal.aborted || lectureId !== currentLectureId) throw new DOMException('Cancelled.', 'AbortError');};
    try {
        if (retry || reset) {await refreshNotesSelection(lectureId,store,{reset}); check();}
        const lecture = await store.getLecture(lectureId); check();
        if (lecture.uploadSource && !lecture.uploadSource.complete) throw uploadError('source_required','Choose the original recording to finish importing before creating notes.');
        const allChunks = await store.getAllChunks(lectureId); check();
        if (allChunks.some(chunk => chunk.status !== 'transcribed')) throw new Error('Transcription is not finished.');
        const assembled = allChunks.length ? assembleTranscript(allChunks, {captureGaps: lecture.captureGaps})
            : {text: lecture.transcript, segments: lecture.segments, warnings: lecture.captureGaps?.length ? ['Recording contains an unknown capture gap.'] : []};
        const fullText = assembled.text;
        if (!fullText.trim()) throw new Error('No speech was transcribed. Retained audio remains available in recovery.');
        const count=splitSources(assembled.sources?.length?assembled.sources:[{text:fullText}]).length;
        let usage=lecture.notesUsage??newUsage(count);
        if(usage.requests>=usage.limit || usage.retries>=usage.retryLimit) {
            if(!confirm(`This lecture has used ${usage.requests} notes requests and ${usage.retries} network/rate-limit retries. Allow up to 10 more requests and 3 more network/rate-limit retries? Completed work will be reused. Provider charges may apply.`))throw Object.assign(new Error('Request allowance was not extended.'),{kind:'budget'});
            usage={...usage,limit:Math.min(1000000,usage.limit+10),retryLimit:Math.min(1000000,usage.retryLimit+3)};
        }
        await store.updateLecture(lectureId,{notesUsage:usage},{signal});check();
        let usagePanel=document.getElementById('notes-usage');
        if(!usagePanel){usagePanel=document.createElement('p');usagePanel.id='notes-usage';usagePanel.className='quiet';document.getElementById('processing-flow').append(usagePanel);}
        const displayUsage=value=>{usagePanel.textContent=`Notes usage: ${value.requests}/${value.limit} requests; ${value.retries}/${value.retryLimit} network/rate-limit retries. Provider-reported tokens: ${value.inputTokens} input, ${value.outputTokens} output (may be incomplete). Estimated first-pass requests: ${Math.max(1,count*2-1)}. No price estimate; account limits still apply.`;};
        displayUsage(usage);
        const governor=createRequestBudget({usage,signal,persist:async value=>{await store.updateLecture(lectureId,{notesUsage:value},{signal});displayUsage(value);},progress:msg=>processingFlow.update('notes',msg)});
        document.getElementById('transcript-content').innerHTML = escapeHTML(fullText);
        document.getElementById('live-transcript').textContent=fullText;
        let warning = document.getElementById('capture-gap-warning');
        if (!warning) {warning = document.createElement('p'); warning.id = 'capture-gap-warning'; document.getElementById('transcript-content').before(warning);}
        warning.textContent = lecture.captureGaps?.length ? 'This recording was interrupted or only partly imported. Some audio may be missing; gap duration is unknown.' : '';
        await store.updateLecture(lectureId, {transcript: fullText, segments: assembled.segments, transcriptSource: 'assembled', status:'processing', analysisStatus: 'processing',processingIssue:undefined}, {signal}); check();
        const results = await runPipeline({transcript: assembled, language: lecture.language,includeExtras:lecture.includeExtras??true}, msg => {
            if (!signal.aborted && lectureId === currentLectureId) processingFlow.update('notes',msg);
        }, {selection: lecture.providerSelections?.completion ?? getProviderSelection('completion', {providerId: 'groq'}), signal,
            checkpoint: lecture.analysisCheckpoint,complete:request=>governor.run(request,complete),
            onCheckpoint: async (analysisCheckpoint, analysis) => {
                check(); await store.updateLecture(lectureId, {analysisCheckpoint, analysis, analysisStatus: 'partial'}, {signal});
                let preview=document.getElementById('partial-notes-preview');
                if(!preview){preview=document.createElement('details');preview.id='partial-notes-preview';const title=document.createElement('summary');title.textContent='Read completed notes while processing';preview.append(title,document.createElement('div'));document.getElementById('processing-flow').append(preview);}
                preview.lastElementChild.textContent=analysis.sections.map(s=>s.notes).join('\n\n');
                preview.lastElementChild.style.whiteSpace='pre-wrap';preview.lastElementChild.style.maxHeight='28rem';preview.lastElementChild.style.overflow='auto';
            }});
        check();
        processingFlow.update('save','Notes checked. Saving your study material in this browser…');
        await store.updateLecture(lectureId, {transcript: fullText, analysis: results, status: 'ready', analysisStatus: 'ready'}, {signal}); check();
        renderLecture(await openLecture(lectureId)); check(); switchView('result-section'); await recoveryControls.refresh();
    } finally {if (reportController === controller) reportController = null; if(!reportActionPending)recoveryControls.setBusy(false);}
}

async function showProcessingError(error, lectureId = currentLectureId, stage = processingFlow?.stage??'prepare') {
    const issue=processingIssue(error,stage);
    let saved;
    try {
        saved = lectureId && await store.getLecture(lectureId);
        if (saved && issue.kind!=='blocked') await store.updateLecture(lectureId, {status: 'failed', analysisStatus: saved.analysisCheckpoint?.maps.length ? 'partial' : 'failed',processingIssue:issue});
    } catch { /* The original failure remains visible even if storage is unavailable. */ }
    if (lectureId === currentLectureId) {
        switchView('recording-section');
        processingFlow.fail(issue,{transcriptSaved:!!saved?.transcript,transcriptComplete:['notes','save'].includes(stage) && (!saved?.uploadSource || saved.uploadSource.complete),
            unsaved:queue.hasUnsavedAudio(),canRetry:!!saved,recording:!!session.active?.recorder?.isRecording});
    }
    recoveryControls?.setBusy((session.busy && session.active?.state !== 'interrupted') || reportActionPending);
    await recoveryControls?.refresh().catch(()=>{});
}


function initReportControls() {
    const action = (id, fn) => document.getElementById(id)?.addEventListener('click', async () => {
        try {await fn();} catch (error) {if(id==='regenerate-report')await showProcessingError(error);else notice(error.message || 'Operation failed.');}
    });
    action('export-md', async () => downloadText(exportMarkdown(await openLecture(currentLectureId)), 'lecture.md', 'text/markdown;charset=utf-8'));
    action('export-csv', async () => downloadText(exportAnkiCsv(await openLecture(currentLectureId)), 'flashcards.csv', 'text/csv;charset=utf-8'));
    action('export-pdf', choosePrintLayout);
    action('print-report', choosePrintLayout);
    action('rename-report', async () => {
        const lecture = await openLecture(currentLectureId), title = prompt('Lecture title', lecture.title);
        if (title !== null) {await renameLecture(lecture.id, title); const updated = await openLecture(lecture.id); if (currentLectureId === lecture.id) renderLecture(updated);}
    });
    action('regenerate-report', async () => {
        if (session.busy || reportController || reportActionPending) {notice('A step is already running. Wait for it to finish.');return;}
        reportActionPending = true;
        try {
        processingFlow.update('notes','Preparing to regenerate notes from your saved transcript…');
        switchView('recording-section');
        await generateFinalReport(currentLectureId,{reset:true});
        } finally {reportActionPending = false;recoveryControls.setBusy(false);}
    });
    document.getElementById('lecture-question-form').addEventListener('submit', async event => {
        event.preventDefault(); if (questionController) return;
        const controller = questionController = new AbortController();
        const output = document.getElementById('lecture-answer'), button = event.currentTarget.querySelector('button');
        button.disabled = true; output.textContent = 'Searching lecture...';
        try {
            const result = await askLecture({signal: controller.signal, lectureId: currentLectureId, question: document.getElementById('lecture-question').value});
            if (questionController !== controller) return;
            output.textContent = result.answer + '\n\n' + result.references.map(r => `${r.id}: "${r.quote}"`).join('\n');
        } catch (error) {if (questionController === controller) output.textContent = error.message || 'Question could not be answered.';}
        finally {if (questionController === controller) {questionController = null; button.disabled = false;}}
    });
}
