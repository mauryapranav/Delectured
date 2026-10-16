/**
 * js/config.js
 * Manages configuration and API keys in localStorage.
 */

import {PROVIDER_IDS, getProviderMetadata, validateBaseUrl} from './providers/catalog.js';
const CONFIG_KEY = 'delectured_config';

const DEFAULT_CONFIG = {
    keys: {
        groq: '',
        openai: '',
        gemini: ''
    },
    defaultProvider: 'groq',
    language: 'en'
};

export function getConfig() {
    try {
        const stored = localStorage.getItem(CONFIG_KEY);
        if (stored) {
            return mergeConfig(JSON.parse(stored));
        }
    } catch (e) {
        console.warn('Failed to load provider settings from local storage.');
    }
    return mergeConfig({});
}

function mergeConfig(value, current = DEFAULT_CONFIG) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid configuration.');
    const keys = {...DEFAULT_CONFIG.keys, ...current.keys};
    if (value.keys !== undefined) {
        if (!value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys)) throw new TypeError('Invalid provider keys.');
        for (const [provider, key] of Object.entries(value.keys)) {
            if (!PROVIDER_IDS.includes(provider) || typeof key !== 'string' || /[\r\n]/.test(key)) throw new TypeError('Invalid provider key.');
            keys[provider] = key.trim();
        }
    }
    const language = value.language ?? current.language;
    if (!['en', 'hi', 'hi-en'].includes(language)) throw new TypeError('Unsupported language.');
    const defaultProvider = value.defaultProvider ?? current.defaultProvider;
    if (!PROVIDER_IDS.includes(defaultProvider)) throw new TypeError('Invalid provider.');
    const transcriptionProvider = value.transcriptionProvider ?? current.transcriptionProvider ?? defaultProvider;
    const notesProvider = value.notesProvider ?? current.notesProvider ?? defaultProvider;
    if (!PROVIDER_IDS.includes(transcriptionProvider) || !getProviderMetadata(transcriptionProvider).transcription) throw new TypeError('Choose a provider with a transcription adapter.');
    if (!PROVIDER_IDS.includes(notesProvider)) throw new TypeError('Choose a supported notes provider.');
    if (value.models !== undefined && (!value.models || typeof value.models !== 'object' || Array.isArray(value.models))) throw new TypeError('Invalid model settings.');
    if (Object.keys(value.models ?? {}).some(id => !PROVIDER_IDS.includes(id))) throw new TypeError('Unknown model provider.');
    const models = {};
    for (const id of PROVIDER_IDS) {
        const update = value.models?.[id];
        if (update !== undefined && (!update || typeof update !== 'object' || Array.isArray(update))) throw new TypeError('Invalid model settings.');
        models[id] = {...getProviderMetadata(id).defaults, ...current.models?.[id]};
        for (const capability of ['transcription', 'completion']) {
            if (update?.[capability] !== undefined) {
                if (typeof update[capability] !== 'string' || /[\r\n]/.test(update[capability])) throw new TypeError('Invalid model ID.');
                models[id][capability] = update[capability].trim();
            }
        }
    }
    const previousUrl = current.compatibleBaseUrl ?? '';
    const suppliedUrl = value.compatibleBaseUrl ?? previousUrl;
    const compatibleBaseUrl = suppliedUrl ? validateBaseUrl(suppliedUrl) : '';
    // A stored custom key is bound to its base URL; changing the destination clears it.
    if (compatibleBaseUrl !== previousUrl && !Object.hasOwn(value.keys ?? {}, 'compatible')) keys.compatible = '';
    return {keys, language, defaultProvider, transcriptionProvider, notesProvider, models, compatibleBaseUrl};
}

export function saveConfig(newConfig) {
    try {
        const current = getConfig();
        const updated = mergeConfig(newConfig, current);
        localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
        return updated;
    } catch (e) {
        console.error('Failed to save provider settings to local storage.');
        throw e;
    }
}

export function getKey(providerId) {
    return getConfig().keys[providerId] || '';
}

export function getLanguage() {
    return getConfig().language || 'en';
}

export function setLanguage(lang) {
    saveConfig({ language: lang });
}
