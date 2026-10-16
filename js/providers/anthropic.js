import {requestJSON, normalizeText, ProviderError} from './http.js';
export async function complete(request) {
    const {key, model, baseUrl, systemPrompt, userPrompt, jsonMode} = request;
    const data = await requestJSON(`${baseUrl}/messages`, {...request, headers: {
        'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'Content-Type': 'application/json',
    }, body: JSON.stringify({model, max_tokens: 8192, stream: false,
        system: jsonMode ? `${systemPrompt}\nReturn only a valid JSON object without Markdown fences.` : systemPrompt,
        messages: [{role: 'user', content: userPrompt}]})});
    if (data?.stop_reason !== 'end_turn') throw new ProviderError('response', 'Anthropic did not finish a complete text response.', request);
    const text = Array.isArray(data.content) ? data.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : undefined;
    return normalizeText(text, request);
}
