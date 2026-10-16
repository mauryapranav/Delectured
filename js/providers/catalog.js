// Capability declarations describe these adapters, not every model offered by a provider.
// Browser connectivity was probed with invalid credentials on 2026-10-14; inference is unverified.
export const PROVIDER_IDS = Object.freeze(['groq', 'openai', 'gemini', 'openrouter', 'mistral', 'anthropic', 'compatible']);
const catalog = {
    groq: {name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', transcription: true, completion: true,
        defaults: {transcription: 'whisper-large-v3-turbo', completion: 'llama-3.3-70b-versatile'}},
    openai: {name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', transcription: true, completion: true,
        defaults: {transcription: 'whisper-1', completion: ''}},
    gemini: {name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/app/apikey', transcription: true, completion: true,
        defaults: {transcription: '', completion: ''}},
    openrouter: {name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys', transcription: false, completion: true,
        defaults: {transcription: '', completion: ''}},
    mistral: {name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', transcription: true, completion: true,
        defaults: {transcription: 'voxtral-mini-latest', completion: ''}},
    anthropic: {name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://platform.claude.com/settings/keys', transcription: false, completion: true,
        defaults: {transcription: '', completion: ''}},
    compatible: {name: 'Custom OpenAI-compatible', baseUrl: '', keyUrl: null, transcription: true, completion: true,
        defaults: {transcription: '', completion: ''}},
};
export function getProviderMetadata(id) {
    if (!PROVIDER_IDS.includes(id)) throw new TypeError('Unknown provider.');
    return {id, ...structuredClone(catalog[id]), verifiedBrowserAccess: id !== 'compatible', verifiedInference: false};
}
export function listProviders() { return PROVIDER_IDS.map(getProviderMetadata); }

export function validateBaseUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new TypeError('Enter a valid API base URL.'); }
    const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
    const localDevelopment = loopback(url.hostname) && loopback(globalThis.location?.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localDevelopment)) throw new TypeError('Custom endpoints require HTTPS; HTTP is allowed only for local development.');
    if (url.username || url.password || url.search || url.hash) throw new TypeError('The API base URL must not contain credentials, query parameters, or a fragment.');
    return url.href.replace(/\/+$/, '');
}
