import {fingerprintUpload,UPLOAD_LIMITS,uploadError} from './upload.js';
import {openUpload} from './upload-reader.js';

export async function chooseUploadPlan(file,lectures,signal) {
    let source;
    try {source=await openUpload(file,signal);}catch {signal?.throwIfAborted();throw uploadError('decode','This browser cannot decode the recording. Try MP3 or PCM WAV.');}
    const seconds=source.seconds;source.close();
    if(!Number.isFinite(seconds)||seconds<=0||seconds>UPLOAD_LIMITS.seconds)throw uploadError('duration','Choose a recording up to two hours.');
    const fingerprint=await fingerprintUpload(file,signal);
    const previous=lectures.find(l=>l.uploadSource?.fingerprint===fingerprint);
    const dialog=document.createElement('dialog');dialog.className='print-options';dialog.id='upload-plan';
    const title=document.createElement('h2');title.id='upload-plan-title';title.textContent=previous?'This recording is already saved':'Review this upload';dialog.setAttribute('aria-labelledby',title.id);
    const text=document.createElement('p');
    text.textContent=`${Math.ceil(seconds/60)} minutes · ${Math.ceil(file.size/1024/1024)} MiB · approximately ${Math.ceil(seconds/300)} transcription requests before retries, with an initial allowance of ${Math.ceil(seconds/300)+8} attempts. Notes requests depend on the actual transcript; their allowance appears before the first notes request. Token use cannot be estimated reliably from audio alone. Provider charges and limits apply.`;
    const label=document.createElement('label'),extras=document.createElement('input');extras.type='checkbox';extras.id='upload-extras';extras.checked=true;
    label.append(extras,document.createTextNode(' Include study extras (concepts, recall and connections). Uses longer responses in the same notes requests.'));
    const actions=document.createElement('div');actions.className='print-options-actions';
    dialog.append(title,text,label,actions);document.body.append(dialog);
    return new Promise(resolve=>{
        let finished=false;
        const finish=value=>{if(finished)return;finished=true;signal?.removeEventListener('abort',cancel);dialog.close();dialog.remove();resolve(value);};
        const cancel=()=>finish(null);
        const button=(name,action)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.addEventListener('click',action);actions.append(b);};
        button('Cancel',cancel);
        if(previous)button('Use saved lecture',()=>finish({existing:previous}));
        button(previous?'Process again (uses API quota)':'Start processing',()=>finish({fingerprint,includeExtras:extras.checked,seconds}));
        dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});signal?.addEventListener('abort',cancel,{once:true});dialog.showModal();
    });
}
