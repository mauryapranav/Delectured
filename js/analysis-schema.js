export const ANALYSIS_LIMITS = Object.freeze({sourceBytes: 5000, packetBytes: 5000, summaryBytes: 2500, requestBytes: 16000});
export const byteLength = value => new TextEncoder().encode(value).length;
// Basic JSON Schema types work with Groq's strict decoder. Content budgets and
// evidence matching remain local checks; schema conformity cannot prove truth.
const schemaObject = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const schemaText = {type:'string'};
const schemaList = items => ({type:'array',items});
const schemaEvidence = schemaList(schemaObject({sourceId:schemaText,quote:schemaText}));
export const PACKET_OUTPUT_SCHEMA = schemaObject({
    notes:schemaText,evidence:schemaEvidence,topics:schemaList(schemaText),
    concepts:schemaList(schemaObject({term:schemaText,definition:schemaText,evidence:schemaEvidence})),
    flashcards:schemaList(schemaObject({q:schemaText,a:schemaText,evidence:schemaEvidence})),
    examSignals:schemaList(schemaObject({label:schemaText,evidence:schemaEvidence})),
    links:schemaList(schemaObject({from:schemaText,to:schemaText,relation:schemaText,evidence:schemaEvidence})),
});
export const OVERVIEW_OUTPUT_SCHEMA = schemaObject({summary:schemaText});
const object = value => {if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object.'); return value;};
const text = (value, max = 2000) => {if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError('Invalid text field.'); return value;};
const list = (value, max, fn) => {if (!Array.isArray(value) || value.length > max) throw new TypeError('Invalid list field.'); return value.map(fn);};
export function validateEvidence(value, sources, field = 'evidence') {
    const refs = list(value, 4, item => {
        object(item); const sourceId = text(item.sourceId, 80); let quote = text(item.quote, 300);
        if (sources) {
            const source = sources.find(s => s.id === sourceId);
            if (!source?.text.includes(quote)) {
                // Ignore formatting whitespace only. Keep words, punctuation and case exact,
                // and persist the real source excerpt so timestamp lookup remains valid.
                const pattern = quote.trim().split(/\s+/u).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
                const matched = source?.text.match(new RegExp(pattern, 'u'))?.[0];
                if (!matched || matched.length > 300) throw Object.assign(new TypeError('Evidence does not occur in its source.'), {evidenceField:field});
                quote = matched;
            }
        }
        return {sourceId, quote};
    });
    if (!refs.length) throw new TypeError('Evidence is required.'); return refs;
}
export function validatePacket(value, sources) {
    object(value);
    const result = {
        notes: text(value.notes), evidence: validateEvidence(value.evidence, sources),
        topics: list(value.topics, 8, s => text(s, 100)),
        concepts: list(value.concepts, 8, item => {object(item); return {term: text(item.term, 100), definition: text(item.definition, 600), evidence: validateEvidence(item.evidence, sources, 'concepts')};}),
        flashcards: list(value.flashcards, 8, item => {object(item); return {q: text(item.q, 300), a: text(item.a, 600), evidence: validateEvidence(item.evidence, sources, 'flashcards')};}),
        examSignals: list(value.examSignals, 4, item => {object(item); return {label: text(item.label, 200), evidence: validateEvidence(item.evidence, sources, 'examSignals')};}),
        links: list(value.links, 8, item => {object(item); return {from: text(item.from, 100), to: text(item.to, 100), relation: text(item.relation, 150), evidence: validateEvidence(item.evidence, sources, 'links')};}),
    };
    if (result.links.some(link => !result.concepts.some(c => c.term === link.from) || !result.concepts.some(c => c.term === link.to))) throw new TypeError('Graph link references an unknown concept.');
    if (byteLength(JSON.stringify(result)) > ANALYSIS_LIMITS.packetBytes) throw new TypeError('Study output exceeds its size budget.');
    return result;
}
export function validateOverview(value) {
    object(value); const summary = text(value.summary, 2500);
    if (byteLength(summary) > ANALYSIS_LIMITS.summaryBytes) throw new TypeError('Overview exceeds its size budget.');
    return {summary};
}
export function validateCheckpoint(value) {
    object(value); if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.key)) throw new TypeError('Invalid analysis checkpoint.');
    return {version: 1, key: value.key,
        maps: list(value.maps, 10000, item => ({id: text(item.id, 80), packet: validatePacket(item.packet)})),
        merges: list(value.merges, 20000, item => ({id: text(item.id, 80), ...validateOverview(item)}))};
}

// Optional persisted study extensions use explicit allowlists, including references.
export function validateStudyFields(value) {
    const result = {};
    if (value.sections !== undefined) result.sections = list(value.sections, 10000, item => ({id: text(item.id, 80), ...validatePacket(item)}));
    if (value.warnings !== undefined) result.warnings = list(value.warnings, 20000, item => text(item, 1000));
    if (value.examEvidence !== undefined) result.examEvidence = list(value.examEvidence, 40000, item => ({label: text(item.label, 200), evidence: validateEvidence(item.evidence)}));
    if (value.timestamps !== undefined) result.timestamps = list(value.timestamps, 200000, item => {
        if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end < item.start) throw new TypeError('Invalid evidence timestamp.');
        return {sourceId: text(item.sourceId, 80), quote: text(item.quote, 300), start: item.start, end: item.end};
    });
    if (value.conceptGraph !== undefined) {
        object(value.conceptGraph);
        const nodes = list(value.conceptGraph.nodes, 80000, n => ({id: text(n.id, 80), label: text(n.label, 100)}));
        const ids = new Set(nodes.map(n => n.id));
        const edges = list(value.conceptGraph.edges, 80000, e => {
            if (!ids.has(e.from) || !ids.has(e.to)) throw new TypeError('Invalid graph edge.');
            return {from: e.from, to: e.to, relation: text(e.relation, 150), evidence: validateEvidence(e.evidence)};
        });
        result.conceptGraph = {nodes, edges};
    }
    if (value.dna !== undefined) {
        object(value.dna);
        result.dna = {method: text(value.dna.method, 1000), windows: list(value.dna.windows, 10000, w => {
            if (![w.start, w.end, w.coverageSeconds].every(n => Number.isFinite(n) && n >= 0) || w.end < w.start || w.coverageSeconds > w.end - w.start) throw new TypeError('Invalid coverage window.');
            return {start: w.start, end: w.end, coverageSeconds: w.coverageSeconds, concepts: list(w.concepts, 80000, s => text(s, 100))};
        })};
    }
    return result;
}
