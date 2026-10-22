export const APPEARANCE_KEY = 'delectured-appearance';
export const normalizeAppearance = value => value === 'modern' ? 'modern' : 'classic';

export function initAppearance(root = document.documentElement, storage = globalThis.localStorage) {
    const button = document.getElementById('appearance-toggle');
    let style = 'classic';
    try {style = normalizeAppearance(storage.getItem(APPEARANCE_KEY));} catch { /* Session preference still works when storage is blocked. */ }
    const apply = value => {
        style = normalizeAppearance(value); root.dataset.appearance = style;
        if (button) {
            button.textContent = style === 'classic' ? 'Paper' : 'Modern';
            button.setAttribute('aria-pressed', String(style === 'classic'));
            button.setAttribute('aria-label', `Classic paper appearance: ${style === 'classic' ? 'on' : 'off'}. Switch to ${style === 'classic' ? 'modern' : 'classic paper'} appearance`);
        }
    };
    apply(style);
    button?.addEventListener('click', () => {
        apply(style === 'classic' ? 'modern' : 'classic');
        try {storage.setItem(APPEARANCE_KEY, style);} catch { /* Keep the selection for this tab. */ }
    });
    globalThis.addEventListener('storage', event => {if (event.key === APPEARANCE_KEY) apply(event.newValue);});
}
if (typeof document !== 'undefined') {
    // Accessing localStorage itself can fail in restricted browser contexts.
    let storage; try {storage = globalThis.localStorage;} catch {storage = {getItem: () => null, setItem: () => {}};}
    initAppearance(document.documentElement, storage);
}
