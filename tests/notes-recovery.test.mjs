import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLectureStore} from '../js/store.js';
import {saveConfig} from '../js/config.js';
import {refreshNotesSelection} from '../js/notes-recovery.js';

test('notes retry replaces the saved model without changing transcript or audio selection', async () => {
    let config;
    globalThis.localStorage = {getItem: () => config, setItem: (_, value) => {config = value;}};
    saveConfig({keys: {groq: 'test-key'}, models: {groq: {completion: 'openai/gpt-oss-120b'}}});
    const store = createLectureStore(`notes-recovery-${crypto.randomUUID()}`);
    const transcription = {providerId: 'groq', model: 'whisper-large-v3-turbo', baseUrl: 'https://api.groq.com/openai/v1'};
    try {
        await store.saveLecture({id: 'lecture', transcript: 'Saved lecture text', providerSelections: {
            transcription, completion: {...transcription, model: 'llama-3.3-70b-versatile'}
        }});
        await refreshNotesSelection('lecture', store);
        const saved = await store.getLecture('lecture');
        assert.equal(saved.providerSelections.completion.model, 'openai/gpt-oss-120b');
        assert.deepEqual(saved.providerSelections.transcription, transcription);
        assert.equal(saved.transcript, 'Saved lecture text');
        assert.equal(saved.analysisCheckpoint, undefined);
        saveConfig({keys: {groq: ''}, models: {groq: {completion: 'another-model'}}});
        await assert.rejects(refreshNotesSelection('lecture', store), {kind: 'auth'});
        assert.equal((await store.getLecture('lecture')).providerSelections.completion.model, 'openai/gpt-oss-120b');
    } finally {await store.close();}
});
