// Reuse saved study material; annotations never trigger another provider request.
export function sectionAnnotation(section, index = 0, used = new Set()) {
    if (index % 2 || used.size >= 6) return null;
    const candidates = [];
    const keyIdea = section.notes?.match(/(?:^|\n)\s*(?:\*\*)?Key idea:(?:\*\*)?\s*([^\n]+)/i)?.[1];
    if (keyIdea) candidates.push({label:'Key idea', text:keyIdea});
    if (index % 4 === 2) {
        for (const card of section.flashcards ?? []) candidates.push({label:'Study question', text:card.q});
    }
    for (const concept of section.concepts ?? []) candidates.push({label:'In focus', text:concept.definition});
    for (const card of section.flashcards ?? []) candidates.push({label:'Study question', text:card.q});
    for (const candidate of candidates) {
        const text = candidate.text?.trim();
        if (!text || text.length > 220 || text.length < 20 || used.has(text) || section.topics?.includes(text)) continue;
        used.add(text);
        return {...candidate, text};
    }
    return null;
}
