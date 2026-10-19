import {PACKET_OUTPUT_SCHEMA, byteLength} from './analysis-schema.js';

// Excerpts are taken locally from the source, never supplied by the model.
export function evidenceChoices(source) {
    const choices = [];
    for (let start = 0; start < source.text.length;) {
        let end = start, bytes = 0;
        for (const char of source.text.slice(start)) {
            const size = byteLength(char);
            if (bytes + size > 160) break;
            bytes += size; end += char.length;
        }
        if (end < source.text.length) {
            const boundary = source.text.lastIndexOf(' ', end);
            if (boundary > start + (end - start) / 2) end = boundary + (boundary < end ? 1 : 0);
        }
        const quote = source.text.slice(start, end);
        if (quote.trim()) choices.push({id:`e${choices.length}`, quote});
        start = end;
    }
    return choices;
}

export function evidenceRepairSchema(choices) {
    const schema = structuredClone(PACKET_OUTPUT_SCHEMA);
    const reference = {type:'array',items:{type:'object',properties:{excerptId:{type:'string',enum:choices.map(c=>c.id)}},required:['excerptId'],additionalProperties:false}};
    schema.properties.evidence = reference;
    for (const field of ['concepts','flashcards','examSignals','links']) schema.properties[field].items.properties.evidence = structuredClone(reference);
    return schema;
}

export function resolveEvidenceChoices(value, source, choices) {
    const result = structuredClone(value), byId = new Map(choices.map(c=>[c.id,c.quote]));
    const resolve = refs => Array.isArray(refs) ? refs.map(ref => {
        // Non-strict providers may retain the original format. It still passes
        // through the usual quote validator; no guessed citation is substituted.
        if (!ref || typeof ref !== 'object' || !Object.hasOwn(ref,'excerptId')) return ref;
        if (Object.keys(ref).length !== 1 || !byId.has(ref.excerptId)) throw new TypeError('Evidence does not occur in its source.');
        return {sourceId:source.id,quote:byId.get(ref.excerptId)};
    }) : refs;
    if (result && typeof result === 'object') {
        result.evidence = resolve(result.evidence);
        for (const field of ['concepts','flashcards','examSignals','links']) {
            if (Array.isArray(result[field])) for (const item of result[field]) if (item && typeof item === 'object') item.evidence = resolve(item.evidence);
        }
    }
    return result;
}

export const evidenceRepairPrompt = `Recreate the study packet using the numbered transcript excerpts supplied below. They contain the original source text in order. For EVERY evidence reference return ONLY {"excerptId":"e0"}, choosing an ID from the supplied excerpts that supports the item. Do not copy or invent quotes or source IDs: the app inserts the original text. Never cite an unrelated excerpt. Omit optional items without support. Keep the same top-level fields: notes, evidence, topics, concepts, flashcards, examSignals, links. Item shapes: concepts={"term":"term","definition":"meaning","evidence":[{"excerptId":"e0"}]}; flashcards={"q":"question","a":"answer","evidence":[{"excerptId":"e0"}]}; examSignals={"label":"explicit cue","evidence":[{"excerptId":"e0"}]}; links={"from":"concept term","to":"concept term","relation":"relationship","evidence":[{"excerptId":"e0"}]}. Topics is a list of strings. Use at most 1200 characters of notes, 3 concepts, 3 flashcards, 2 links, 1 exam cue, and 1 evidence reference per item. Definitions and answers at most 150 characters. Lists may be empty; notes and its evidence are required. Only explicit exam cues; links must refer to extracted concepts. Return only JSON matching the schema.`;
