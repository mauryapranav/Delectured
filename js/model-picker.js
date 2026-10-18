import {fetchModels,modelsForTask,suggestedModel} from './providers/models.js';
import {refreshSelects} from './select-control.js';

export function attachModelPicker(provider,group,{baseUrl,selections}) {
    const key=document.getElementById(`key-${provider.id}`);
    const button=document.createElement('button');button.type='button';button.className='secondary-text-btn';
    button.textContent='Find models & suggest';button.id=`find-models-${provider.id}`;
    const status=document.createElement('p');status.className='quiet';status.setAttribute('role','status');
    const controls=[];let controller,revision=0;
    for(const task of ['transcription','completion']) {
        const input=document.getElementById(`model-${provider.id}-${task}`);if(!input)continue;
        const host=document.createElement('div');host.hidden=true;
        const select=document.createElement('select');select.id=`choose-${provider.id}-${task}`;
        select.setAttribute('aria-label',`${provider.name} ${task==='completion'?'notes':'transcription'} model`);
        const manual=document.createElement('button');manual.type='button';manual.className='secondary-text-btn';manual.textContent='Enter model ID manually';
        host.append(select,manual);input.after(host);
        manual.addEventListener('click',()=>{host.hidden=true;input.hidden=false;input.focus();});
        select.addEventListener('change',()=>{input.value=select.value;});
        input.addEventListener('input',reset);
        controls.push({task,input,select,host});
    }
    group.append(button,status);
    function reset() {
        revision++;controller?.abort();button.disabled=false;status.textContent='';
        for(const c of controls){c.host.hidden=true;c.input.hidden=false;}
    }
    key.addEventListener('input',reset);if(provider.id==='compatible')baseUrl.addEventListener('input',reset);
    button.addEventListener('click',async()=>{
        reset();const version=revision;controller=new AbortController();button.disabled=true;
        status.textContent='Checking the provider’s current model list…';
        try {
            const models=await fetchModels({providerId:provider.id,key:key.value,baseUrl:baseUrl.value,signal:controller.signal});
            if(version!==revision)return;
            const selected=selections();let choices=0;
            for(const c of controls) {
                if(selected[c.task]!==provider.id)continue;
                const list=modelsForTask(models,provider.id,c.task),suggestion=suggestedModel(models,provider.id,c.task);
                c.select.replaceChildren();
                const placeholder=new Option('Choose a model','');c.select.append(placeholder);
                for(const m of list)c.select.append(new Option(m.id+(m.id===suggestion?' — suggested':''),m.id));
                // Preserve an existing available selection; never silently swap a working model.
                const unlisted=c.input.value.trim() && !list.some(m=>m.id===c.input.value);
                const chosen=unlisted?'':list.some(m=>m.id===c.input.value)?c.input.value:suggestion??'';
                if(!unlisted)c.input.value=chosen;
                c.select.value=chosen;
                if(list.length){c.host.hidden=false;c.input.hidden=!unlisted;choices+=list.length;}
            }
            refreshSelects(group);
            status.textContent=choices?'Models loaded. Review the suggested choice, then save settings. Listing does not verify generation access or remaining quota.':'No suitable models were identified for this task. Enter an exact model ID manually or choose another provider.';
        }catch(error){if(version===revision && error.name!=='AbortError')status.textContent=error.message;}
        finally{if(version===revision)button.disabled=false;}
    });
    return {reset};
}
