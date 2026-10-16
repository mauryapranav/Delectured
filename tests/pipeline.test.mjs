import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPipeline, splitSources} from '../js/pipeline.js';
import {byteLength, ANALYSIS_LIMITS, validatePacket} from '../js/analysis-schema.js';
import {createLectureStore} from '../js/store.js';
import {createBackup, parseBackup} from '../js/schema.js';
const selection = {providerId: 'groq', model: 'fixture-model', baseUrl: 'https://api.groq.com/openai/v1'};
export function packet(source) {
    const quote = source.text.trim().slice(0, 80), evidence = [{sourceId: source.id, quote}];
    return {notes: `Notes ${quote} ${source.text.slice(-80)}`, evidence, topics: ['Topic'], concepts: [{term: 'Term', definition: quote, evidence}],
        flashcards: [{q: 'What was said?', a: quote, evidence}], examSignals: [], links: []};
}
const response = request => {
    const p = JSON.parse(request.userPrompt);
    return JSON.stringify(p.stage === 'extract' ? packet(p.source) : {summary: 'Merged overview'});
};
test('long multilingual analysis bounds every request and preserves the final section', async () => {
    const text = ('हिंदी code x += 1; explained.\n').repeat(1800) + 'FINAL_IMPORTANT_DETAIL'; const calls = [];
    const result = await runPipeline({transcript: text, language: 'hi-en'}, () => {}, {selection, complete: async request => {calls.push(request); return response(request);}});
    assert(calls.length > 10);
    assert(calls.every(r => byteLength(r.systemPrompt) + byteLength(r.userPrompt) <= ANALYSIS_LIMITS.requestBytes));
    assert(calls.every(r => r.systemPrompt.includes('Hinglish')));
    assert.equal(result.sections.length, splitSources([{text}]).length);
    // The compact overview may omit a detail; each complete extraction packet remains saved.
    assert(result.sections.at(-1).notes.includes('FINAL_IMPORTANT_DETAIL')); assert.deepEqual(result.scores, {});
    assert.equal(splitSources([{text}]).map(w => w.text).join(''), text);
    assert(JSON.parse(calls.filter(r => JSON.parse(r.userPrompt).stage === 'extract').at(-1).userPrompt).source.text.includes('FINAL_IMPORTANT_DETAIL'));
});
test('partial analysis survives real storage reopen and resumes without repeating completed requests', async () => {
    const store = createLectureStore(crypto.randomUUID()); const text = 'First section. '.repeat(450) + 'Last section.'; let calls = 0;
    await store.saveLecture({id: 'resume', transcript: text});
    const onCheckpoint = (analysisCheckpoint, analysis) => store.updateLecture('resume', {analysisCheckpoint, analysis, analysisStatus: 'partial'});
    await assert.rejects(runPipeline(text, () => {}, {selection, onCheckpoint, complete: async request => {
        if (++calls === 2) throw Object.assign(new Error('Invalid key'), {kind: 'auth'}); return response(request);
    }}), {kind: 'auth'});
    await store.close(); const saved = await store.getLecture('resume');
    assert.equal(saved.analysisCheckpoint.maps.length, 1); assert.equal(saved.analysis.sections.length, 1); assert.equal(saved.transcript, text);
    const resumed = []; const result = await runPipeline(text, () => {}, {selection, checkpoint: saved.analysisCheckpoint, onCheckpoint, complete: async request => {resumed.push(JSON.parse(request.userPrompt)); return response(request);}});
    assert(!resumed.some(p => p.source?.id === 'w0')); assert.equal(result.sections.length, 2);
    await store.updateLecture('resume', {analysis: result});
    const restored = parseBackup(createBackup([await store.getLecture('resume')]))[0];
    assert.equal(restored.analysis.sections.length, 2); assert.equal(restored.analysis.conceptGraph.nodes.length, 1);
    await store.close();
});
test('malformed output gets exactly one repair and invented evidence is rejected', async () => {
    let calls = 0;
    const result = await runPipeline('Valid source words.', () => {}, {selection, complete: async r => ++calls === 1 ? '{broken' : response(r)});
    assert.equal(calls, 2); assert(result.sections.length);
    calls = 0;
    await assert.rejects(runPipeline('Valid source words.', () => {}, {selection, complete: async r => {
        calls++; const p = packet(JSON.parse(r.userPrompt).source); p.evidence[0].quote = 'invented quote'; return JSON.stringify(p);
    }}), /twice/); assert.equal(calls, 2);
    assert.throws(() => validatePacket({notes: 'missing fields'}));
});

test('exhausted repair exposes a safe reason instead of hiding the notes failure', async () => {
    await assert.rejects(runPipeline('Valid source words.', () => {}, {selection,
        complete: async () => '{private provider text'}), error => {
        assert.equal(error.kind, 'study_output');
        assert.match(error.message, /invalid JSON/);
        assert(!error.message.includes('private provider text'));
        return true;
    });
    await assert.rejects(runPipeline('Valid source words.', () => {}, {selection,
        complete: async r => {
            const p = packet(JSON.parse(r.userPrompt).source);
            p.evidence[0].quote = 'invented quote';
            return JSON.stringify(p);
        }}), error => {
        assert.equal(error.kind, 'study_output');
        assert.match(error.message, /Evidence does not occur in its source/);
        return true;
    });
});
test('changed model or language invalidates checkpoints; abort retains last completed checkpoint', async () => {
    let checkpoint; const controller = new AbortController(); let calls = 0;
    const text = 'Some material. '.repeat(500);
    await assert.rejects(runPipeline(text, () => {}, {selection, signal: controller.signal,
        complete: async r => {calls++; return response(r);}, onCheckpoint: c => {checkpoint = c; controller.abort();}}), {name: 'AbortError'});
    assert.equal(calls, 1); assert.equal(checkpoint.maps.length, 1);
    const ids = []; await runPipeline({transcript: text, language: 'hi'}, () => {}, {selection: {...selection, model: 'new-model'}, checkpoint,
        complete: async r => {ids.push(JSON.parse(r.userPrompt).source?.id); return response(r);}});
    assert(ids.includes('w0'));
});
test('timestamps and DNA use evidence segments, while missing timing stays unknown', async () => {
    const transcript = {text: 'Exact evidence.', sources: [{text: 'Exact evidence.', segments: [{start: 305, end: 310, text: 'Exact evidence.'}]}], segments: [{start: 305, end: 310, text: 'Exact evidence.'}], warnings: []};
    const result = await runPipeline({transcript}, () => {}, {selection, complete: async r => response(r)});
    assert.equal(result.timestamps[0].start, 305); assert.equal(result.dna.windows[0].coverageSeconds, 5);
    assert.deepEqual(result.dna.windows[0].concepts, ['Term']);
    const unknown = await runPipeline('Exact evidence.', () => {}, {selection, complete: async r => response(r)});
    assert.deepEqual(unknown.timestamps, []); assert.deepEqual(unknown.dna.windows, []);
});
test('repeated concepts retain support in every measured time window', async () => {
    const segments = [{start: 0, end: 5, text: 'Exact evidence.'}, {start: 305, end: 310, text: 'Exact evidence.'}];
    const transcript = {text: 'Exact evidence.\n\nExact evidence.', sources: segments.map(s => ({text: s.text, segments: [s]})), segments};
    const result = await runPipeline({transcript}, () => {}, {selection, complete: async r => response(r)});
    assert.equal(result.concepts.length, 1);
    assert.deepEqual(result.dna.windows.map(w => w.concepts), [['Term'], ['Term']]);
});
