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
