import {validateLecture} from './schema.js';

export function exportMarkdown(value) {
    const l = validateLecture(value), a = l.analysis;
    const labels = new Map((a.conceptGraph?.nodes ?? []).map(n => [n.id, n.label]));
    const parts = [`# ${l.title}`, `Date: ${l.createdAt}\nLanguage: ${l.language}\nDuration: ${l.durationMs / 1000} seconds`, `## Summary\n${a.summary}`];
    for (const s of a.sections ?? []) parts.push(`## Section ${s.id}\n${s.notes}\n\n${s.evidence.map(e => `> ${e.sourceId}: ${e.quote}`).join('\n')}`);
    parts.push(`## Topics\n${a.topics.map(t => `- ${t}`).join('\n')}`, `## Concepts\n${a.concepts.map(c => `### ${c.term}\n${c.definition}`).join('\n\n')}`,
        `## Flashcards\n${a.flashcards.map(f => `Q: ${f.q}\nA: ${f.a}`).join('\n\n')}`, `## Exam cues\n${a.examSignals.join('\n')}`,
        `## Exam evidence\n${(a.examEvidence ?? []).map(s => `${s.label}\n${s.evidence.map(e => `> ${e.sourceId}: ${e.quote}`).join('\n')}`).join('\n\n')}`,
        `## Concept links\n${(a.conceptGraph?.edges ?? []).map(e => `${labels.get(e.from)} — ${e.relation} — ${labels.get(e.to)}`).join('\n')}`,
        `## Lecture DNA\n${a.dna ? a.dna.method + '\n' + a.dna.windows.map(w => `${w.start}–${w.end}s: ${w.coverageSeconds}s of transcript segment coverage; concepts: ${w.concepts.join(', ') || 'none linked'}`).join('\n') : 'No measured data.'}`,
        `## Evidence times\n${(a.timestamps ?? []).map(t => `${t.start}–${t.end}s: ${t.quote}`).join('\n')}`,
        `## Limitations\n${(a.warnings ?? []).join('\n')}`, `## Transcript\n${l.transcript}`);
    return parts.join('\n\n') + '\n';
}
function csvCell(value) {
    // Spreadsheet applications can execute formula-like cells even when CSV-quoted.
    const safe = /^[\s]*[=+@-]/u.test(value) ? "'" + value : value;
    return `"${safe.replaceAll('"', '""')}"`;
}
export function exportAnkiCsv(value) {
    return validateLecture(value).analysis.flashcards.map(f => [f.q, f.a].map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
