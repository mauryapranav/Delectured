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
    const reference = {type:'array',minItems:1,maxItems:choices.length,items:{type:'object',properties:{excerptId:{type:'string',enum:choices.map(c=>c.id)}},required:['excerptId'],additionalProperties:false}};
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
            if (Array.isArray(result[field])) for (const item of result[field]) if (item && typeof item === 'object') {try {item.evidence = resolve(item.evidence);} catch {item.evidence = [];}}
        }
    }
    return result;
}

export const evidenceRepairPrompt = String.raw`Create useful study notes for the CURRENT source, using the numbered excerpts in order. Neighbouring context is background only.
Return ONE JSON object. No introduction, no Markdown fence around JSON, no trailing commas. Escape newlines as \n and quotes as \" inside JSON strings. Markdown is allowed inside the notes string.
First write clear notes explaining what this section actually teaches: definitions, mechanisms, relevant examples, equations or code. Preserve uncertainty; never guess missing context. Do not invent exam claims. If the section is only introductory or administrative, briefly say what it contains without inventing study content.
Use short descriptive headings and connected explanations, not a list of repeated topic names. Where supported, explain how an idea works, why it matters, and how it relates to another idea in this source. Preserve useful examples and distinctions. Do not add outside examples or pad thin material. A study question must be clearly phrased as a question rather than attributed to the lecturer.
Use this complete output shape (values below illustrate structure, not lecture facts):
{"notes":"Concise notes supported by the current excerpts.","evidence":[{"excerptId":"e0"}],"topics":[],"concepts":[],"flashcards":[],"examSignals":[],"links":[]}
Notes and evidence are required. Cite only actual excerpt IDs supplied in this request; select the excerpts supporting your notes. Never write quotes or source IDs yourself. Usually 1-4 references suffice, but include every supplied excerpt needed to support the notes. Never invent an ID or repeat the same reference.
Aim for 800-1500 characters of notes; maximum 2000. Prioritize the notes. Optional lists may stay empty. If adding extras, use at most 3 topics, 3 concepts, 3 flashcards, 1 exam cue and 2 links. Definitions and answers should stay under 150 characters. Entire JSON should stay under 5000 UTF-8 bytes; use fewer optional items rather than cut essential notes.
Optional item shapes:
concepts: {"term":"name","definition":"meaning","evidence":[{"excerptId":"e0"}]}
flashcards: {"q":"question","a":"answer","evidence":[{"excerptId":"e0"}]}
examSignals: {"label":"explicit instructor cue","evidence":[{"excerptId":"e0"}]}
links: {"from":"exact extracted concept term","to":"exact extracted concept term","relation":"relationship","evidence":[{"excerptId":"e0"}]}
Topics are strings. Each optional item needs a relevant reference. Omit unsupported optional items. Both link endpoints must exist in concepts. Return the JSON object only.`;
