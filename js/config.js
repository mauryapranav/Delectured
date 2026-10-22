/**
 * js/config.js
 * Stores settings locally; credentials use session storage unless explicitly remembered.
 */

import {PROVIDER_IDS, getProviderMetadata, validateBaseUrl} from './providers/catalog.js';
const CONFIG_KEY = 'delectured_config';
const SESSION_KEY = 'delectured_session_keys';
const memoryKeys = new WeakMap();

function sessionKeys() {
    if (memoryKeys.has(globalThis.localStorage)) return memoryKeys.get(globalThis.localStorage);
    try {
        const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }
    catch { return memoryKeys.get(globalThis.localStorage) || {}; }
}
function writeSessionKeys(value) {
    memoryKeys.set(globalThis.localStorage, value);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); } catch { /* In-memory keys remain usable in this tab. */ }
}

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
            const value = JSON.parse(stored);
            // Keep existing saved credentials usable; new installations default to session-only.
            const rememberKeys = value.rememberKeys ?? Object.values(value.keys || {}).some(Boolean);
            const session = sessionKeys();
            const keys = !rememberKeys && session.binding === value.keySessionBinding ? session.keys : value.keys;
            return mergeConfig({...value, keys, rememberKeys});
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
    const rememberKeys = value.rememberKeys ?? current.rememberKeys ?? false;
    if (typeof rememberKeys !== 'boolean') throw new TypeError('Invalid key storage preference.');
    return {keys, language, defaultProvider, transcriptionProvider, notesProvider, models, compatibleBaseUrl, rememberKeys};
}

export function saveConfig(newConfig) {
    try {
        const current = getConfig();
        const updated = mergeConfig(newConfig, current);
        const previous = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
        const binding = current.rememberKeys === updated.rememberKeys && current.compatibleBaseUrl === updated.compatibleBaseUrl
            ? previous.keySessionBinding || globalThis.crypto.randomUUID() : globalThis.crypto.randomUUID();
        localStorage.setItem(CONFIG_KEY, JSON.stringify({...updated, keys: updated.rememberKeys ? updated.keys : {}, keySessionBinding: binding}));
        writeSessionKeys(updated.rememberKeys ? {} : {keys: updated.keys, binding});
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
