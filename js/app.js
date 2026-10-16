/**
 * js/app.js
 * Main UI Orchestrator for DeLectured v3
 */
import { getConfig, setLanguage } from './config.js';
import {validateProviderConfiguration, getProviderSelection} from './providers/index.js';
import {initProviderSettings} from './provider-settings.js';
import {Session} from './session.js';
import { Queue } from './queue.js';
import {initQueueControls} from './queue-controls.js';
import {refreshNotesSelection} from './notes-recovery.js';
import { runPipeline } from './pipeline.js';
import {assembleTranscript} from './transcript.js';
import * as store from './store.js';
import {escapeHTML} from './safe-render.js';
import {renderLecture} from './report.js';
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
let stopPromise = null;
let stopMeter = () => {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    switchView(new URL(location.href).searchParams.has('capture') ? 'input-section' : 'welcome-section');
    const busy = () => session.busy || Boolean(reportController) || reportActionPending;
    const shell = initShell({busy});
    // 2. Keys Drawer
    const settings = initKeysDrawer();
    updateSetupStatus();

    // 3. Language Selector
    initLangSelector();

    // 4. Input Handlers
    document.getElementById('start-record-btn')?.addEventListener('click', startRecording);
    document.getElementById('stop-record-btn')?.addEventListener('click', () => stopRecording().catch(showProcessingError));
    document.getElementById('discard-record-btn')?.addEventListener('click', () => discardRecording().catch(showProcessingError));
    recoveryControls = initQueueControls(queue, {
        beforeRetry: async id => {
            if (reportController) throw Object.assign(new Error('Wait for the current report or discard it first.'), {kind: 'blocked'});
            if (session.busy && (session.active?.id !== id || session.active.state !== 'interrupted')) throw Object.assign(new Error('Stop the current session before recovery.'), {kind: 'blocked'});
            currentLectureId = id; switchView('recording-section');
        },
        recover: (id, options) => session.recover(id, options),
        recovered: async (id, options) => {
            try {await generateFinalReport(id, options);}
            catch (error) {await showProcessingError(error, id); throw error;}
        },
        discard: id => id === currentLectureId ? discardRecording() : queue.discard(id),
    });
    queue.subscribe(event => {
        if (event.lectureId !== currentLectureId) return;
        if (event.status === 'blocked') {
            showProcessingError(event.error, event.lectureId); return;
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
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.warn('Service Worker registration failed:', err);
        });
    }
});


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
}
async function startRecording() {
    if (session.busy || reportController) return;
    try {await session.start(providerOptions());}
    catch (error) {if (error.name === 'AbortError') return; await showProcessingError(error); alert(error.message || 'Recording could not start.');}
}
async function startUpload(file) {
    if (session.busy || reportController) return;
    try {const id = await session.upload(file, providerOptions()); await generateFinalReport(id);}
    catch (error) {if (error.name === 'AbortError') return; await showProcessingError(error); alert(error.message);}
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
}

async function generateFinalReport(lectureId = currentLectureId, {retry = false} = {}) {
    if (lectureId !== currentLectureId) return;
    if (reportController) throw new Error('A report is already being prepared.');
    const controller = new AbortController(); reportController = controller;
    const signal = controller.signal;
    const check = () => {if (signal.aborted || lectureId !== currentLectureId) throw new DOMException('Cancelled.', 'AbortError');};
    try {
        if (retry) {await refreshNotesSelection(lectureId); check();}
        const lecture = await store.getLecture(lectureId); check();
        const allChunks = await store.getAllChunks(lectureId); check();
        if (allChunks.some(chunk => chunk.status !== 'transcribed')) throw new Error('Transcription is not finished.');
        const assembled = allChunks.length ? assembleTranscript(allChunks, {captureGaps: lecture.captureGaps})
            : {text: lecture.transcript, segments: lecture.segments, warnings: lecture.captureGaps?.length ? ['Recording contains an unknown capture gap.'] : []};
        const fullText = assembled.text;
        if (!fullText.trim()) throw new Error('No speech was transcribed. Retained audio remains available in recovery.');
        document.getElementById('transcript-content').innerHTML = escapeHTML(fullText);
        let warning = document.getElementById('capture-gap-warning');
        if (!warning) {warning = document.createElement('p'); warning.id = 'capture-gap-warning'; document.getElementById('transcript-content').before(warning);}
        warning.textContent = lecture.captureGaps?.length ? 'This recording was interrupted or only partly imported. Some audio may be missing; gap duration is unknown.' : '';
        await store.updateLecture(lectureId, {transcript: fullText, segments: assembled.segments, transcriptSource: 'assembled', analysisStatus: 'processing'}, {signal}); check();
        const results = await runPipeline({transcript: assembled, language: lecture.language}, msg => {
            if (!signal.aborted && lectureId === currentLectureId) document.getElementById('recording-caption').innerText = msg;
        }, {selection: lecture.providerSelections?.completion ?? getProviderSelection('completion', {providerId: 'groq'}), signal,
            checkpoint: lecture.analysisCheckpoint,
            onCheckpoint: async (analysisCheckpoint, analysis) => {
                check(); await store.updateLecture(lectureId, {analysisCheckpoint, analysis, analysisStatus: 'partial'}, {signal});
            }});
        check();
        await store.updateLecture(lectureId, {transcript: fullText, analysis: results, status: 'ready', analysisStatus: 'ready'}, {signal}); check();
        renderLecture(await openLecture(lectureId)); check(); switchView('result-section'); await recoveryControls.refresh();
    } finally {if (reportController === controller) reportController = null;}
}

async function showProcessingError(error, lectureId = currentLectureId) {
    const message = error.name === 'AbortError' ? 'Processing cancelled.' : (error.kind ? error.message : 'Processing failed. Your saved audio and transcript are retained.');
    if (lectureId === currentLectureId) document.getElementById('recording-caption').innerText = message;
    try {
        const saved = lectureId && await store.getLecture(lectureId);
        if (saved) await store.updateLecture(lectureId, {status: 'failed', analysisStatus: saved.analysisCheckpoint?.maps.length ? 'partial' : 'failed'});
    } catch { /* The original failure remains visible even if storage is unavailable. */ }
}


function initReportControls() {
    const action = (id, fn) => document.getElementById(id)?.addEventListener('click', async () => {
        try {await fn();} catch (error) {alert(error.message || 'Operation failed.');}
    });
    action('export-md', async () => downloadText(exportMarkdown(await openLecture(currentLectureId)), 'lecture.md', 'text/markdown;charset=utf-8'));
    action('export-csv', async () => downloadText(exportAnkiCsv(await openLecture(currentLectureId)), 'flashcards.csv', 'text/csv;charset=utf-8'));
    action('export-pdf', () => window.print());
    action('print-report', () => window.print());
    action('rename-report', async () => {
        const lecture = await openLecture(currentLectureId), title = prompt('Lecture title', lecture.title);
        if (title !== null) {await renameLecture(lecture.id, title); const updated = await openLecture(lecture.id); if (currentLectureId === lecture.id) renderLecture(updated);}
    });
    action('regenerate-report', async () => {
        if (session.busy || reportController) throw new Error('Wait for the current work to finish.');
        reportActionPending = true;
        try {
        await store.updateLecture(currentLectureId, {providerSelections: {transcription: (await openLecture(currentLectureId)).providerSelections?.transcription ?? getProviderSelection('transcription'), completion: validateProviderConfiguration('completion')}, analysisCheckpoint: undefined});
        switchView('recording-section');
        try {await generateFinalReport();} catch (error) {await showProcessingError(error); throw error;}
        } finally {reportActionPending = false;}
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
