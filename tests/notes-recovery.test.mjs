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

test('legacy lecture retry fills missing selections without requiring an audio key', async () => {
    let config;
    globalThis.localStorage = {getItem: () => config, setItem: (_, value) => {config = value;}};
    saveConfig({keys: {groq: 'test-key'}, transcriptionProvider: 'gemini', models: {groq: {completion: 'notes-model'}}});
    const store = createLectureStore(`legacy-recovery-${crypto.randomUUID()}`);
    try {
        await store.saveLecture({id: 'old', transcript: 'Already transcribed.'});
        await refreshNotesSelection('old', store);
        const saved = await store.getLecture('old');
        assert.equal(saved.providerSelections.completion.model, 'notes-model');
        assert.equal(saved.providerSelections.transcription.providerId, 'groq');
        assert.equal(saved.providerSelections.transcription.model, 'whisper-large-v3-turbo');
        assert.equal(saved.transcript, 'Already transcribed.');
    } finally {await store.close();}
});

test('retry with unchanged notes settings preserves validated checkpoints', async () => {
    let config;
    globalThis.localStorage = {getItem: () => config, setItem: (_, value) => {config = value;}};
    saveConfig({keys: {groq: 'test-key'}, models: {groq: {completion: 'notes-model'}}});
    const store = createLectureStore(`checkpoint-recovery-${crypto.randomUUID()}`);
    try {
        const selection = {providerId: 'groq', model: 'notes-model', baseUrl: 'https://api.groq.com/openai/v1'};
        const checkpoint = {version: 1, key: 'a'.repeat(64), maps: [], merges: []};
        await store.saveLecture({id: 'partial', transcript: 'Saved text', analysisCheckpoint: checkpoint,
            providerSelections: {transcription: {...selection, model: 'whisper-large-v3-turbo'}, completion: selection}});
        await refreshNotesSelection('partial', store);
        assert.deepEqual((await store.getLecture('partial')).analysisCheckpoint, checkpoint);
        await refreshNotesSelection('partial', store, {reset:true});
        assert.equal((await store.getLecture('partial')).analysisCheckpoint, undefined);
    } finally {await store.close();}
});
