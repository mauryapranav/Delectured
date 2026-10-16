import {getConfig} from '../config.js';
import {PROVIDER_IDS, getProviderMetadata, validateBaseUrl} from './catalog.js';
import {ProviderError, throwIfAborted} from './http.js';
import * as groq from './groq.js';
import * as openai from './openai.js';
import * as gemini from './gemini.js';
import * as openrouter from './openrouter.js';
import * as mistral from './mistral.js';
import * as anthropic from './anthropic.js';
import * as compatible from './compatible.js';
const adapters = {groq, openai, gemini, openrouter, mistral, anthropic, compatible};
export {listProviders} from './catalog.js';
export {ProviderError} from './http.js';

export function getProviderCapabilities(id) {
    if (!PROVIDER_IDS.includes(id)) throw new ProviderError('unsupported', 'Unknown provider.');
    const {transcription, completion, verifiedBrowserAccess, verifiedInference} = getProviderMetadata(id);
    return {transcription, completion, verifiedBrowserAccess, verifiedInference};
}
export function getProviderSelection(capability, overrides = {}, config = getConfig()) {
    if (!['transcription', 'completion'].includes(capability)) throw new ProviderError('unsupported', 'Unknown provider capability.');
    const providerId = overrides.providerId ?? (capability === 'transcription' ? config.transcriptionProvider : config.notesProvider);
    if (!getProviderCapabilities(providerId)[capability]) throw new ProviderError('unsupported', 'This provider has no adapter for the requested capability.', {providerId});
    const metadata = getProviderMetadata(providerId);
    const model = overrides.model ?? config.models[providerId][capability];
    if (typeof model !== 'string' || !model.trim() || /[\r\n]/.test(model)) throw new ProviderError('unsupported', 'Set a model ID for this provider and capability in Keys.', {providerId});
    let baseUrl = metadata.baseUrl;
    if (providerId === 'compatible') {
        try { baseUrl = validateBaseUrl(config.compatibleBaseUrl); }
        catch { throw new ProviderError('unsupported', 'Configure a valid HTTPS base URL for the custom provider.', {providerId}); }
    }
    // Saved lecture settings cannot redirect a provider key to an imported/arbitrary URL.
    if (overrides.baseUrl !== undefined && overrides.baseUrl !== baseUrl) throw new ProviderError('unsupported', 'The saved endpoint differs from the configured endpoint. Restore its settings before retrying.', {providerId});
    return {providerId, model: model.trim(), baseUrl};
}
export function validateProviderConfiguration(capability, overrides = {}) {
    const config = getConfig();
    const selection = getProviderSelection(capability, overrides, config);
    if (!config.keys[selection.providerId]) throw new ProviderError('auth', 'Set an API key for the selected provider in Keys.', {providerId: selection.providerId});
    return selection; // No credentials in persisted lecture selections.
}
function resolveRequest(capability, options) {
    throwIfAborted(options.signal);
    const config = getConfig();
    const selection = getProviderSelection(capability, options, config);
    const key = config.keys[selection.providerId];
    if (!key) throw new ProviderError('auth', 'Set an API key for the selected provider in Keys.', {providerId: selection.providerId});
    return {...options, ...selection, key};
}
export async function transcribeAudio(options) {
    const request = resolveRequest('transcription', options);
    return adapters[request.providerId].transcribeAudio(request);
}
export async function complete(options) {
    const request = resolveRequest('completion', options);
    if (typeof request.systemPrompt !== 'string' || typeof request.userPrompt !== 'string') throw new ProviderError('unsupported', 'Notes requests require text prompts.', request);
    return adapters[request.providerId].complete(request);
}
