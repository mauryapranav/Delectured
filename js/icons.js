// Small shared outline icons, drawn locally without a font or network dependency.
const paths = {
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M14.5 14.5L21 21',
    document: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
    mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',
    library: 'M3 4h4v17H3z M10 4h4v17h-4z M17 5l4-1 3 16-4 1z',
    home: 'M3 11l9-8 9 8 M5 10v11h5v-7h4v7h5V10',
    settings: 'M9.5 2h5l.5 3 2 1 2.8-1 2.5 4.3-2.3 2v2.4l2.3 2-2.5 4.3-2.8-1-2 1-.5 3h-5l-.5-3-2-1-2.8 1-2.5-4.3 2.3-2v-2.4l-2.3-2L4.2 5 7 6l2-1 .5-3Z M15.5 12.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
    export: 'M12 15V3 M8 7l4-4 4 4 M5 12v8h14v-8',
    chevron: 'M6 9l6 6 6-6',
    arrow: 'M4 12h16 M14 6l6 6-6 6',
    chat: 'M21 11a9 8 0 0 1-9 8H8l-5 3 1-6a8 8 0 0 1-1-5 9 8 0 0 1 18 0',
    send: 'M3 10l18-7-7 18-3-8z M11 13L21 3',
};
export function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false'); svg.classList.add('ui-icon');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.document);
    svg.append(path); return svg;
}
export function initIcons() {
    document.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));
}
