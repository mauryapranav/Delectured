import {requestJSON, normalizeText, normalizeTranscript, ProviderError} from './http.js';

export function audioFile(blob) {
    if (!(blob instanceof Blob) || !blob.size) throw new ProviderError('unsupported', 'Provide a non-empty audio chunk.');
    // Application guard, not a promise about each provider's account-specific limit.
    if (blob.size > 25 * 1024 * 1024) throw new ProviderError('unsupported', 'Split audio into chunks smaller than 25 MiB.');
    const types = {'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a',
        'video/mp4': 'mp4', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/flac': 'flac'};
    const extension = types[blob.type.split(';')[0].toLowerCase()];
    if (!extension) throw new ProviderError('unsupported', 'Unsupported or missing audio content type.');
    return `chunk.${extension}`;
}
export function languageCode(language) {
    if (!['en', 'hi', 'hi-en'].includes(language)) throw new ProviderError('unsupported', 'Choose English, Hindi, or Hinglish.');
    // Leave mixed-language speech unforced; do not translate it into Hindi.
    return language === 'hi-en' ? undefined : language;
}
export async function chatCompletion(request, {jsonFormat = true, structuredOutput = false} = {}) {
    const {key, model, baseUrl, systemPrompt, userPrompt, jsonMode} = request;
    const system = jsonMode ? `${systemPrompt}\nReturn only a valid JSON object, without Markdown fences.` : systemPrompt;
    const payload = {model, messages: [{role: 'system', content: system}, {role: 'user', content: userPrompt}], stream: false};
    if (jsonMode && jsonFormat) payload.response_format = {type: 'json_object'};
    // Gemini's compatibility API supports schemas; Groq support is model-specific.
    if (jsonMode && jsonFormat && request.outputSchema && (structuredOutput || request.providerId === 'groq'
        && ['openai/gpt-oss-120b','openai/gpt-oss-20b'].includes(model))) {
        payload.response_format = {type:'json_schema',json_schema:{name:'study_output',strict:true,schema:request.outputSchema}};
    }
    const send = async () => {
        const body = JSON.stringify(payload);
        try {return await requestJSON(`${baseUrl}/chat/completions`, {...request,
            headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body});}
        catch(error) {
            error.requestBytes = new TextEncoder().encode(body).length;
            error.responseFormat = payload.response_format?.type ?? 'text';
            throw error;
        }
    };
    let data;
    try {data = await send();} catch (error) {
        // Only an explicitly rejected schema gets a different request, once.
        // Local validation remains mandatory in JSON-object mode.
        if (request.providerId !== 'gemini' || error.status !== 400 || error.rejection !== 'schema' || payload.response_format?.type !== 'json_schema') throw error;
        payload.response_format = {type:'json_object'};
        try {data = await send();} catch (fallback) {fallback.schemaFallback = true; throw fallback;}
    }
    const choice = data?.choices?.[0];
    if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new ProviderError('response', 'The provider did not finish a complete text response.', request);
    return normalizeText(choice?.message?.content, request);
}
export async function fileTranscription(request, {style = 'whisper'} = {}) {
    const {blob, model, language, baseUrl, key, providerId} = request;
    const body = new FormData();
    body.append('file', blob, audioFile(blob));
    body.append('model', model);
    const lang = languageCode(language);
    // Mistral forbids combining forced language with requested timestamps.
    if (lang && style !== 'mistral') body.append('language', lang);
    if (style === 'whisper') body.append('response_format', 'verbose_json');
    else if (style === 'mistral') body.append('timestamp_granularities[]', 'segment');
    else body.append('response_format', 'json');
    return normalizeTranscript(await requestJSON(`${baseUrl}/audio/transcriptions`, {...request,
        headers: {Authorization: `Bearer ${key}`}, body}), providerId);
}
