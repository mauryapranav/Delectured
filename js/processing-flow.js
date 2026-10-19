import {PROVIDER_IDS} from './providers/catalog.js';
import {safeValidationIssue,explainValidation} from './study-validation.js';
export const PROCESSING_STAGES = Object.freeze(['prepare', 'transcribe', 'notes', 'save']);
const labels = {prepare:'Prepare audio', transcribe:'Transcribe audio', notes:'Create study notes', save:'Save study material'};
const kinds = ['auth','quota','rate_limit','network','unsupported','response','study_output','storage','cancelled','permission','input','unknown'];
const reasons = ['json','evidence','size','incomplete','empty','schema','unknown','empty_file','file_size','file_format','decode','duration','source_required','source_mismatch'];
export function processingIssue(error, stage, now = Date.now()) {
    let kind = error.name === 'AbortError' ? 'cancelled' : error.name === 'NotAllowedError' ? 'permission'
        : ['QuotaExceededError','UnknownError'].includes(error.name) || stage === 'save' ? 'storage' : error.kind;
    if (!kinds.includes(kind)) kind = 'unknown';
    const message = String(error.message ?? '');
    const reason = kind === 'input' && reasons.includes(error.reason) ? error.reason : kind !== 'study_output' ? 'unknown' : message.includes('invalid JSON') ? 'json'
        : message.includes('Evidence') ? 'evidence' : /budget|size/.test(message) ? 'size'
        : message.includes('stopped before') ? 'incomplete' : message.includes('empty notes') ? 'empty' : 'schema';
    return validateProcessingIssue({stage,kind,reason,status:error.status,providerId:error.providerId,section:error.section,totalSections:error.totalSections,validationIssue:error.validationIssue,
        retryAt:kind === 'rate_limit' && Number.isFinite(error.retryAfterMs) ? now + Math.max(0,error.retryAfterMs) : undefined});
}
export function validateProcessingIssue(value) {
    if (!value || !PROCESSING_STAGES.includes(value.stage) || !kinds.includes(value.kind) || !reasons.includes(value.reason)) throw new TypeError('Invalid processing issue.');
    return {stage:value.stage,kind:value.kind,reason:value.reason,
        ...(safeValidationIssue(value.validationIssue)?{validationIssue:safeValidationIssue(value.validationIssue)}:{}),
        ...(Number.isInteger(value.section) && Number.isInteger(value.totalSections) && value.section > 0 && value.section <= value.totalSections && value.totalSections <= 10000 ? {section:value.section,totalSections:value.totalSections} : {}),
        ...(PROVIDER_IDS.includes(value.providerId)?{providerId:value.providerId}:{}),
        ...(Number.isInteger(value.status) && value.status >= 400 && value.status <= 599 ? {status:value.status} : {}),
        ...(Number.isFinite(value.retryAt) && value.retryAt >= 0 ? {retryAt:value.retryAt} : {})};
}
export function describeIssue(issue) {
    const descriptions = {
        auth:['Provider access was rejected.', 'Open Settings and check the key and model access for this step.'],
        permission:['Microphone access was not granted.', 'Allow microphone access in your browser, then start recording again. You can also upload audio.'],
        input:[['source_required','source_mismatch'].includes(issue.reason) ? (issue.reason === 'source_mismatch' ? 'The selected file does not match the original recording.' : 'The original recording is needed to finish this upload.') : ({empty_file:'The selected file is empty.',file_size:'This file exceeds the 500 MiB upload limit.',file_format:'This file type is not supported.',decode:'This browser could not read or decode the audio.',duration:'The audio exceeds the supported duration or channel limits, or its duration could not be read.'})[issue.reason] || 'This audio file could not be prepared.', ['source_required','source_mismatch'].includes(issue.reason) ? 'Use Choose original file to continue in Saved work below. Completed transcript sections will be reused.' : 'Choose a playable MP3 or WAV file, at most 500 MiB and two hours, with mono or stereo audio. Convert or split the original file if needed, then upload again.'],
        quota:['Your provider account has no available quota.', 'Check your provider account or choose another configured provider in Settings before retrying.'],
        rate_limit:['Your provider needs more time before another request.', issue.retryAt ? 'Wait for the countdown, then retry this step.' : 'No retry time was supplied. Check your provider’s limits before trying again.'],
        network:['The provider could not be reached.', 'Check your connection and try again. If other sites work, the provider may be temporarily unavailable.'],
        unsupported:[issue.status === 404 ? 'The selected model or endpoint is unavailable.' : issue.status === 413 ? 'The provider rejected the request size.' : 'The provider settings or input are not supported.', 'Open Settings to check the provider and model. Saved text does not need to be transcribed again.'],
        response:issue.status ? ['The provider rejected this request.', 'Check the selected model and its supported settings before retrying.'] : ['The provider returned a response this app could not use.', 'Try again once. If it repeats, check the selected model in Settings.'],
        study_output:[({json:'The AI returned notes in a format the app could not read.', evidence:'The AI supplied a quote that could not be found in this transcript section. The app stopped instead of showing an unverified quote.', size:'The AI wrote too much for one notes section.', incomplete:'The provider stopped before finishing its response.', empty:'The provider returned an empty response.', schema:'The AI left out required parts of the notes or used the wrong format.'})[issue.reason] || 'The notes could not be validated.', 'The app already asked the AI to try again once. Click Retry notes to continue from saved sections. Your audio does not need to be uploaded again. If the same section fails again, choose another notes model in Settings; changing models restarts notes generation.'],
        storage:['This browser could not save the result.', 'Keep this tab open. Save any available transcript or audio, then free device space before retrying.'],
        cancelled:['Notes generation was stopped.', 'You can resume from saved progress when you are ready.'],
        unknown:['This step could not finish.', 'Keep this tab open and save any available transcript or audio. Retry the step; if it repeats, use the details below to report the problem.'],
    };
    let [detail,next] = descriptions[issue.kind];
    if(issue.kind==='study_output' && issue.validationIssue)detail=explainValidation(issue.validationIssue);
    return {title:issue.stage === 'notes' && issue.section ? `Notes ${issue.kind === 'cancelled' ? 'paused' : 'stopped'} at section ${issue.section} of ${issue.totalSections}` : `${labels[issue.stage]} ${issue.kind === 'cancelled' ? 'paused' : 'needs attention'}`,detail,next,
        diagnostic:`Step: ${labels[issue.stage]}${issue.providerId?` · Provider: ${issue.providerId}`:''} · ${issue.kind}${issue.status ? ` · HTTP ${issue.status}` : ''} · ${issue.reason}${issue.validationIssue?` · ${explainValidation(issue.validationIssue)}`:''}`};
}

export function initProcessingFlow({retry,settings,exportTranscript,cancel}) {
    const section = document.getElementById('recording-section');
    const host = document.createElement('div'); host.className='processing-flow'; host.id='processing-flow';
    host.innerHTML = `<ol class="processing-steps" aria-label="Lecture progress">${PROCESSING_STAGES.map((s,i)=>`<li data-step="${s}"><span class="step-number">${i+1}</span><span>${labels[s]}<small>Waiting</small></span></li>`).join('')}</ol>
        <section id="processing-problem" class="processing-problem" hidden aria-labelledby="processing-problem-title">
        <h2 id="processing-problem-title"></h2><p id="processing-reason"></p><p id="processing-preserved"></p><p id="processing-next"></p>
        <div class="processing-actions"><button id="processing-retry" class="primary-action-btn">Retry this step</button><button id="processing-settings" class="secondary-text-btn">Open Settings</button><button id="processing-export" class="secondary-text-btn">Save transcript</button></div>
        <p id="processing-wait" role="status"></p><details><summary>Problem details</summary><p id="processing-diagnostic"></p><button id="processing-copy" class="secondary-text-btn">Copy problem details</button><p id="processing-copy-status" role="status"></p></details></section>
        <button id="processing-cancel" class="secondary-text-btn" hidden>Pause notes generation</button>`;
    section.querySelector('.progress-rule-container').before(host);
    const el = id=>document.getElementById(id); let stage='prepare', timer, currentIssue;
    el('processing-retry').addEventListener('click',()=>{if(!el('processing-retry').disabled)void retry();});
    el('processing-settings').addEventListener('click',settings);
    el('processing-export').addEventListener('click',exportTranscript);
    el('processing-cancel').addEventListener('click',cancel);
    el('processing-copy').addEventListener('click',async()=>{
        try {await navigator.clipboard.writeText(el('processing-diagnostic').textContent);el('processing-copy-status').textContent='Copied. No keys or lecture text are included.';}
        catch {el('processing-copy-status').textContent='Copy is unavailable. Select and copy the details above.';}
    });
    function steps(failed=false) {
        const at=PROCESSING_STAGES.indexOf(stage);
        host.querySelectorAll('[data-step]').forEach((item,i)=>{
            item.dataset.state=i<at?'complete':i===at?(failed?'failed':'active'):'waiting';
            item.querySelector('small').textContent=i<at?'Complete':i===at?(failed?'Needs attention':'In progress'):'Waiting';
            if(i===at)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
        });
    }
    function update(nextStage,detail,{recording=false}={}) {
        clearInterval(timer); currentIssue=null; stage=nextStage; steps();
        el('processing-problem').hidden=true; el('processing-cancel').hidden=stage!=='notes';
        el('record-timer').hidden=!recording; el('record-canvas').hidden=!recording;
        el('stop-record-btn').hidden=!recording; el('discard-record-btn').hidden=!recording;
        el('recording-title').textContent=recording?'Recording lecture':labels[stage];
        el('recording-caption').textContent=detail;
        section.dataset.processingState='working';
    }
    function fail(issue,{transcriptSaved=false,transcriptComplete=false,unsaved=false,canRetry=true,recording=false}={}) {
        clearInterval(timer); currentIssue=issue; stage=issue.stage; steps(true);
        const text=describeIssue(issue);
        el('recording-title').textContent=recording?'Recording continues — transcription needs attention':text.title;
        el('recording-caption').textContent=recording?`The microphone is still recording. Stop & save when ready. ${text.detail}`:text.detail;
        el('record-timer').hidden=!recording; el('record-canvas').hidden=!recording;
        el('stop-record-btn').hidden=!recording; el('discard-record-btn').hidden=!recording; el('processing-cancel').hidden=true;
        if(recording){const first=host.querySelector('[data-step="prepare"]');first.dataset.state='active';first.querySelector('small').textContent='Recording';}
        el('processing-problem').hidden=false; section.dataset.processingState='failed';
        el('processing-problem-title').textContent=text.title; el('processing-reason').textContent=text.detail;
        el('processing-next').textContent=text.next; el('processing-diagnostic').textContent=text.diagnostic;
        el('processing-copy-status').textContent='';
        el('processing-preserved').textContent=unsaved?'Some audio exists only in this tab. Keep it open and export retained audio below.'
            :transcriptSaved?(transcriptComplete?'Your completed transcript is saved in this browser. You do not need to upload or transcribe it again.':'Completed transcript sections are saved. The remaining audio still needs transcription.')
            :'Completed audio and text may be available in Saved work below. Keep this tab open until you have checked or exported them.';
        el('processing-export').hidden=!transcriptSaved;
        el('processing-retry').hidden=!canRetry || recording || issue.kind==='permission';
        el('processing-retry').textContent=stage==='notes'?'Retry notes':stage==='save'?'Resume saved work':'Retry this step';
        const tick=()=>{
            const seconds=Math.max(0,Math.ceil(((currentIssue?.retryAt??0)-Date.now())/1000));
            el('processing-retry').disabled=seconds>0;
            el('processing-wait').textContent=seconds?`Try again in ${seconds} seconds.`:'';
            if(!seconds)clearInterval(timer);
        };
        tick(); if(issue.retryAt>Date.now())timer=setInterval(tick,1000);
    }
    return {update,fail,get stage(){return stage;}};
}
