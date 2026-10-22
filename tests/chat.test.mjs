import {test} from 'node:test';
import assert from 'node:assert/strict';
import {askLecture, retrievePassages} from '../js/chat.js';
test('bounded Q&A validates quotes and rejects fabricated citations', async () => {
    const transcript = 'Vector addition uses components. '.repeat(500);
    let calls = 0;
    const options = {openLecture: async () => ({transcript}), complete: async req => {
        calls++; assert(new TextEncoder().encode(req.userPrompt + req.systemPrompt).length <= 18000);
        const p = JSON.parse(req.userPrompt).passages[0];
        return JSON.stringify({answerable: true, answer: 'Use components.', references: [{id: p.id, quote: 'Vector addition uses components.'}]});
    }};
    assert.equal((await askLecture({lectureId: 'x', question: 'Vector addition?'}, options)).references.length, 1);
    assert.equal((await askLecture({lectureId: 'x', question: 'Photosynthesis?'}, options)).references.length, 0);
    assert.equal(calls, 1);
    await assert.rejects(askLecture({lectureId: 'x', question: 'Vector?'}, {...options, complete: async () => JSON.stringify({answerable: true, answer: 'bad', references: [{id: 'p0', quote: 'fabricated'}]})}));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(askLecture({lectureId: 'x', question: 'Vector?', signal: controller.signal}, options), {name: 'AbortError'});
    assert(retrievePassages('हिंदी में सदिश', 'सदिश').length);
});

test('Q&A requests JSON and hides provider text in parsing failures', async () => {
    const options = {openLecture: async () => ({transcript: 'Python uses indentation.'}), complete: async req => {
        assert.equal(req.jsonMode, true);
        return '{private-response-text';
    }};
    await assert.rejects(askLecture({lectureId: 'x', question: 'Python?'}, options), error => {
        assert.equal(error.message, 'The provider returned invalid answer JSON. Try the question again.');
        return true;
    });
});

test('Q&A reuses validated answers only for unchanged lecture question model and endpoint', async () => {
    let calls = 0, transcript = 'Python uses indentation.', model = 'test-model', baseUrl = 'https://example.com';
    const options = {openLecture: async () => ({transcript}), getProviderSelection: () => ({providerId: 'groq', model, baseUrl}), complete: async req => {
        calls++; assert.equal(req.model, model);
        return JSON.stringify({answerable: true, answer: 'Use indentation.', references: [{id:'p0', quote:'Python uses indentation.'}]});
    }};
    const request = {lectureId:'cache-lecture', question:'Python?'};
    const first = await askLecture(request, options);
    first.references[0].quote = 'changed';
    assert.equal((await askLecture(request, options)).references[0].quote, 'Python uses indentation.');
    assert.equal(calls, 1);
    transcript += ' Functions use def.'; await askLecture(request, options);
    model = 'another-model'; await askLecture(request, options);
    baseUrl = 'https://another.example'; await askLecture(request, options);
    await askLecture({...request, question:'Python indentation?'}, options);
    assert.equal(calls, 5);
});

test('Q&A rejects concurrent submissions and releases its guard after failure without automatic retries', async () => {
    let release, calls = 0;
    const options = {openLecture: async () => ({transcript:'Python uses indentation.'}), getProviderSelection: () => ({providerId:'groq', model:'test'}), complete: () => {
        calls++; return new Promise((resolve, reject) => {release = () => reject(new Error('temporary failure'));});
    }};
    const request = {lectureId:'concurrent', question:'Python?'};
    const first = askLecture(request, options);
    const rejected = assert.rejects(first, /temporary failure/);
    while (!release) await new Promise(resolve => setTimeout(resolve, 1));
    await assert.rejects(askLecture(request, options), /Another question/);
    release(); await rejected;
    assert.equal(calls, 1);
    const second = askLecture(request, options);
    const secondRejected = assert.rejects(second, /temporary failure/);
    while (calls < 2) await new Promise(resolve => setTimeout(resolve, 1));
    release(); await secondRejected;
    assert.equal(calls, 2);
});

test('Q&A cross-tab lock refuses a second request before using the provider', async () => {
    if (!globalThis.navigator?.locks) return;
    await navigator.locks.request('delectured-question', async () => {
        let calls = 0;
        const options = {openLecture: async () => ({transcript:'Python uses indentation.'}),
            getProviderSelection: () => ({providerId:'groq', model:'test'}), complete: async () => { calls++; }};
        await assert.rejects(askLecture({lectureId:'cross-tab', question:'Python?'}, options), /Another tab/);
        assert.equal(calls, 0);
    });
});
