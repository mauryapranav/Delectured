// Functional controls in the existing drawer. Visual design remains assigned to Layer 8.
import {getConfig, saveConfig} from './config.js';
import {listProviders} from './providers/catalog.js';
import {refreshSelects} from './select-control.js';
import {attachModelPicker} from './model-picker.js';

export function initProviderSettings() {
    const content = document.querySelector('#keys-drawer .drawer-content');
    const saveButton = document.getElementById('save-keys-btn');
    const providers = listProviders();
    const groups = new Map();
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
    const intro = document.createElement('p'); intro.className = 'drawer-desc';
    intro.textContent = 'Choose who transcribes your audio and who creates your notes. They can be different providers.';
    choices.append(intro);
    const rememberLabel = document.createElement('label');
    const remember = document.createElement('input'); remember.type = 'checkbox'; remember.id = 'remember-provider-keys';
    rememberLabel.append(remember, ' Remember API keys in this browser');
    const storageNote = document.createElement('p'); storageNote.className = 'drawer-desc';
    storageNote.textContent = 'Unchecked: keys are kept for this tab session. Checked: keys remain on this browser until removed. Browser extensions and anyone using this profile may access saved keys.';
    choices.append(rememberLabel, storageNote);
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
        groups.set(provider.id, group);
        choices.append(group);
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
    const destination = document.createElement('p'); destination.className = 'drawer-desc';
    baseUrl.parentElement.append(destination);
    function showDestination() {
        try { destination.textContent = `Your custom API key and lecture content will be sent to ${new URL(baseUrl.value).origin}. Only use a server you trust.`; }
        catch { destination.textContent = 'Enter the server address to see where your custom API key and lecture content will be sent.'; }
    }
    const selections = () => ({transcription:document.getElementById('transcription-provider').value,
        completion:document.getElementById('notes-provider').value});
    const pickers=providers.map(provider=>attachModelPicker(provider,groups.get(provider.id),{baseUrl,selections}));
    function updateFields() {
        const selected = selections();
        for (const provider of providers) {
            groups.get(provider.id).hidden = !Object.values(selected).includes(provider.id);
            for (const capability of ['transcription','completion']) {
                const input = document.getElementById(`model-${provider.id}-${capability}`);
                if (input) input.parentElement.hidden = selected[capability] !== provider.id;
            }
        }
        baseUrl.parentElement.hidden = !Object.values(selected).includes('compatible');
    }
    for (const id of ['transcription-provider','notes-provider']) document.getElementById(id).addEventListener('change',()=>{pickers.forEach(p=>p.reset());updateFields();});
    baseUrl.addEventListener('input', () => {
        if (baseUrl.value.replace(/\/+$/, '') !== loadedCustomUrl) document.getElementById('key-compatible').value = '';
        showDestination();
    });
    const note = document.createElement('p'); note.className = 'drawer-desc';
    note.textContent = 'Enter a key, then use Find models & suggest to avoid typing model names. Suggestions favor known task-compatible models; they are not a guarantee of quality, price or account access. Provider limits apply. Keys stay in this browser and are sent only to the chosen provider. Gemini audio has no timestamps.';
    choices.append(note);
    refreshSelects(choices);
    updateFields();
    return {
        load() {
            pickers.forEach(p=>p.reset());
            const config = getConfig();
            remember.checked = config.rememberKeys;
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
            showDestination();
            updateFields();
            refreshSelects(choices);
        },
        save() {
            const keys = {}, models = {};
            const selected = selections();
            for (const provider of providers) {
                if (!Object.values(selected).includes(provider.id)) continue;
                keys[provider.id] = document.getElementById(`key-${provider.id}`).value;
                models[provider.id] = {};
                for (const capability of ['transcription', 'completion']) {
                    const input = document.getElementById(`model-${provider.id}-${capability}`);
                    if (input && selected[capability] === provider.id) models[provider.id][capability] = input.value;
                }
            }
            saveConfig({keys, models, rememberKeys: remember.checked, ...(Object.values(selected).includes('compatible') ? {compatibleBaseUrl: baseUrl.value.trim()} : {}),
                transcriptionProvider: document.getElementById('transcription-provider').value,
                notesProvider: document.getElementById('notes-provider').value});
        },
    };
}
