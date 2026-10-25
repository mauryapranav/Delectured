/** Text-only user work, deliberately separate from generated evidence. */
const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid personal note.'); return value; };
const text = (value, max, empty = false) => { if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new TypeError('Invalid personal note text.'); return value; };
const list = value => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > 10000) throw new TypeError('Too many personal notes.'); return value; };
function unique(items, field) { if (new Set(items.map(item => item[field])).size !== items.length) throw new TypeError('Duplicate personal note identity.'); return items; }
export function validatePersonalNotes(value) {
    return unique(list(value).map(item => { object(item); return {sectionId:text(item.sectionId, 180), text:text(item.text, 100000, true)}; }), 'sectionId');
}
export function validateAnnotations(value) {
    return unique(list(value).map(item => {
        object(item);
        if (!Number.isSafeInteger(item.occurrence) || item.occurrence < 0 || item.occurrence > 100000) throw new TypeError('Invalid passage occurrence.');
        if (!['before','after'].includes(item.placement)) throw new TypeError('Invalid annotation placement.');
        return {id:text(item.id, 180), sectionId:text(item.sectionId, 180), quote:text(item.quote, 2000, true), occurrence:item.occurrence, text:text(item.text, 10000), placement:item.placement};
    }), 'id');
}
export function personalSections(analysis = {}, personalNotes = []) {
    const overrides = new Map(personalNotes.map(note => [note.sectionId, note.text]));
    return [{id:'overview', label:'Overview', generated:analysis.summary || ''}, ...(analysis.sections || []).map((section, index) => ({id:`section:${section.id}`, label:section.topics?.[0] || `Section ${index + 1}`, generated:section.notes || ''}))]
        .map(section => ({...section, text:overrides.has(section.id) ? overrides.get(section.id) : section.generated, edited:overrides.has(section.id)}));
}
/** Resolve the exact quoted occurrence, never silently attach to another passage. */
export function quoteOffset(text, quote, occurrence = 0) {
    if (!quote) return 0;
    let offset = -1;
    for (let index = 0; index <= occurrence; index++) { offset = text.indexOf(quote, offset + 1); if (offset < 0) return -1; }
    return offset;
}
export function personalStudyText(lecture) {
    const notes = lecture.personalNotes || [], annotations = lecture.annotations || [];
    if (!notes.length && !annotations.length) return '';
    return '\n\nPERSONAL NOTES — your writing, not AI evidence\n' + notes.map(note => `[${note.sectionId}]\n${note.text}`).join('\n\n') +
        annotations.map(note => `\n\n[${note.sectionId}; ${note.placement}] ${note.quote ? `“${note.quote}”` : 'Whole section'}\n→ ${note.text}`).join('');
}
