// Functional controls in the existing drawer. Visual design remains assigned to Layer 8.
import {getConfig, saveConfig} from './config.js';
import {listProviders} from './providers/catalog.js';
import {refreshSelects} from './select-control.js';

export function initProviderSettings() {
    const content = document.querySelector('#keys-drawer .drawer-content');
    const saveButton = document.getElementById('save-keys-btn');
    const providers = listProviders();
    let loadedCustomUrl = '';
    const field = (parent, label, id, type = 'text') => {
        const wrapper = document.createElement('div'); wrapper.className = 'provider-group';
        const caption = document.createElement('label'); caption.htmlFor = id; caption.textContent = label;
        const input = document.createElement(type === 'select' ? 'select' : 'input'); input.id = id; input.className = 'key-input';
        if (type !== 'select') { input.type = type; input.autocomplete = 'off'; input.spellcheck = false; }
        wrapper.append(caption, input); parent.append(wrapper);
        return input;
    };
    const choices = document.createElement('div');
    content.insertBefore(choices, saveButton);
    for (const [id, label, capability] of [['transcription-provider', 'Transcription provider', 'transcription'], ['notes-provider', 'Notes provider', 'completion']]) {
        const select = field(choices, label, id, 'select');
        for (const provider of providers.filter(p => p[capability])) {
            const option = document.createElement('option'); option.value = provider.id; option.textContent = provider.name;
            select.append(option);
        }
    }
    for (const provider of providers) {
        let keyInput = document.getElementById(`key-${provider.id}`);
        if (!keyInput) keyInput = field(choices, provider.name, `key-${provider.id}`, 'password');
        keyInput.autocomplete = 'off';
        const group = keyInput.parentElement;
        let link = group.querySelector('a');
        if (provider.keyUrl) {
            if (!link) { link = document.createElement('a'); group.querySelector('label').append(' ', link); }
            link.href = provider.keyUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Get key'; link.className = 'provider-link';
        }
        for (const capability of ['transcription', 'completion']) {
            if (!provider[capability]) continue;
            const input = field(group, `${capability === 'completion' ? 'Notes' : 'Transcription'} model ID`, `model-${provider.id}-${capability}`);
            input.placeholder = provider.defaults[capability] || 'Enter a model available to your account';
        }
    }
    const baseUrl = field(choices, 'Custom API base URL (including /v1 if required)', 'compatible-base-url', 'url');
    baseUrl.addEventListener('input', () => {
        if (baseUrl.value.replace(/\/+$/, '') !== loadedCustomUrl) document.getElementById('key-compatible').value = '';
    });
    const note = document.createElement('p'); note.className = 'drawer-desc';
    note.textContent = 'Provider requests use your own key and quota. Browser connectivity checked; successful requests still require a valid key and supported model. Custom endpoints are unverified. Gemini audio returns text without timestamps.';
    choices.append(note);
    refreshSelects(choices);
    return {
        load() {
            const config = getConfig();
            for (const provider of providers) {
                document.getElementById(`key-${provider.id}`).value = config.keys[provider.id] || '';
                for (const capability of ['transcription', 'completion']) {
                    const input = document.getElementById(`model-${provider.id}-${capability}`);
                    if (input) input.value = config.models[provider.id][capability];
                }
            }
            document.getElementById('transcription-provider').value = config.transcriptionProvider;
            document.getElementById('notes-provider').value = config.notesProvider;
            baseUrl.value = loadedCustomUrl = config.compatibleBaseUrl;
            refreshSelects(choices);
        },
        save() {
            const keys = {}, models = {};
            for (const provider of providers) {
                keys[provider.id] = document.getElementById(`key-${provider.id}`).value;
                models[provider.id] = {};
                for (const capability of ['transcription', 'completion']) {
                    const input = document.getElementById(`model-${provider.id}-${capability}`);
                    if (input) models[provider.id][capability] = input.value;
                }
            }
            saveConfig({keys, models, compatibleBaseUrl: baseUrl.value.trim(),
                transcriptionProvider: document.getElementById('transcription-provider').value,
                notesProvider: document.getElementById('notes-provider').value});
        },
    };
}
