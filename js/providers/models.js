import {getProviderMetadata,validateBaseUrl} from './catalog.js';
import {requestJSON,ProviderError} from './http.js';

export async function fetchModels({providerId,key,baseUrl,signal}) {
    const provider=getProviderMetadata(providerId);
    if(!key?.trim())throw new ProviderError('auth','Enter this provider’s API key first.');
    const root=providerId==='compatible'?validateBaseUrl(baseUrl):provider.baseUrl;
    const endpoint=providerId==='gemini'?'https://generativelanguage.googleapis.com/v1beta/models':`${root}/models`;
    const headers=providerId==='gemini'?{'x-goog-api-key':key.trim()}:providerId==='anthropic'
        ?{'x-api-key':key.trim(),'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'}:{Authorization:`Bearer ${key.trim()}`};
    let token, models=[];
    for(let page=0;page<20;page++) {
        const url=new URL(endpoint);
        if(providerId==='gemini'){url.searchParams.set('pageSize','1000');if(token)url.searchParams.set('pageToken',token);}
        if(providerId==='anthropic'){url.searchParams.set('limit','1000');if(token)url.searchParams.set('after_id',token);}
        const data=await requestJSON(url.href,{providerId,headers,signal,method:'GET',timeoutMs:20000});
        const list=providerId==='gemini'?data.models:data.data;
        if(!Array.isArray(list))throw new ProviderError('response','The provider returned an unreadable model list.');
        models.push(...list.filter(m=>m && typeof (m.id??m.name)==='string' && m.active!==false).map(m=>({
            id:(m.id??m.name).replace(/^models\//,''),methods:m.supportedGenerationMethods,
            capabilities:m.capabilities,architecture:m.architecture,
        })).filter(m=>m.id.length<=200 && /^[\w./:-]+$/.test(m.id)));
        token=providerId==='gemini'?data.nextPageToken:providerId==='anthropic'&&data.has_more?data.last_id:null;
        if(!token)return [...new Map(models.map(m=>[m.id,m])).values()];
    }
    throw new ProviderError('response','The model list is too large. Enter a model ID manually.');
}

export function modelsForTask(models,providerId,task) {
    return models.filter(m=>{
        const id=m.id.toLowerCase();
        if(/embed|moderation|guard|image|tts|realtime|live|vision-preview/.test(id))return false;
        if(providerId==='gemini')return id.startsWith('gemini-') && m.methods?.includes('generateContent');
        if(task==='transcription')return /whisper|transcribe|voxtral.*(mini|transcrib)/.test(id);
        if(/whisper|transcrib/.test(id))return false;
        if(providerId==='mistral' && m.capabilities)return m.capabilities.completion_chat===true;
        if(providerId==='openrouter' && m.architecture)return m.architecture.output_modalities?.includes('text');
        if(providerId==='openai')return /^(gpt-|chatgpt-)/.test(id) && !/audio|search|codex|instruct/.test(id);
        return true;
    }).sort((a,b)=>b.id.localeCompare(a.id,undefined,{numeric:true}));
}

// Recommendations are compatibility-oriented, not claims of universal quality or price.
export function suggestedModel(models,providerId,task) {
    const ids=modelsForTask(models,providerId,task).map(m=>m.id);
    const preferred=task==='transcription'
        ? providerId==='groq'?['whisper-large-v3-turbo','whisper-large-v3']:providerId==='openai'?['whisper-1']:providerId==='mistral'?['voxtral-mini-latest']:[]
        : providerId==='groq'?['openai/gpt-oss-120b','openai/gpt-oss-20b']:providerId==='openai'?['gpt-4.1-mini','gpt-4o-mini']:providerId==='mistral'?['mistral-small-latest']:[];
    const known=preferred.find(id=>ids.includes(id));if(known)return known;
    if(providerId==='gemini')return ids.find(id=>/^gemini-[\d.]+-flash(-lite)?$/.test(id));
    // Unknown/custom models require an explicit choice; names alone cannot prove support.
    return undefined;
}
