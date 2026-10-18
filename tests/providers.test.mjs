import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {transcribeAudio, complete, getProviderCapabilities, getProviderSelection} from '../js/providers/index.js';
import {saveConfig, getConfig} from '../js/config.js';
import {parseRetryAfter, ProviderError, requestJSON} from '../js/providers/http.js';
import {validateBaseUrl, listProviders} from '../js/providers/catalog.js';
import {PACKET_OUTPUT_SCHEMA} from '../js/analysis-schema.js';
let requests, originalFetch;
beforeEach(() => {
    let saved;
    globalThis.localStorage = {getItem: () => saved, setItem: (_, value) => {saved = value;}};
    originalFetch = globalThis.fetch;
    requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({url, ...options});
        return Response.json({choices: [{finish_reason: 'stop', message: {content: '{"summary":"ok"}'}}]});
    };
});

test('all text adapters normalize results and send only their own key', async () => {
    for (const provider of listProviders()) {
        saveConfig({keys: {[provider.id]: `test-${provider.id}`}, models: {[provider.id]: {completion: 'account-model'}},
            ...(provider.id === 'compatible' ? {compatibleBaseUrl: 'https://custom.example/v1'} : {})});
        globalThis.fetch = async (url, options) => {
            requests.push({url, ...options});
            return Response.json(provider.id === 'anthropic'
                ? {stop_reason: 'end_turn', content: [{type: 'text', text: '{"summary":"ok"}'}]}
                : {choices: [{finish_reason: 'stop', message: {content: '{"summary":"ok"}'}}]});
        };
        assert.equal(await complete({providerId: provider.id, systemPrompt: 'System', userPrompt: 'Lecture', jsonMode: true}), '{"summary":"ok"}');
        const request = requests.at(-1);
        assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
        assert.equal(provider.id === 'anthropic' ? request.headers['x-api-key'] : request.headers.Authorization,
            provider.id === 'anthropic' ? `test-${provider.id}` : `Bearer test-${provider.id}`);
        if (provider.id === 'anthropic') assert.equal(request.headers['anthropic-dangerous-direct-browser-access'], 'true');
        assert.equal(JSON.parse(request.body).model, 'account-model');
    }
});

test('strict study schema is sent only to supported Groq models', async () => {
    saveConfig({keys:{groq:'test-key',openai:'test-key'}});
    for (const [providerId,model,expected] of [['groq','openai/gpt-oss-120b','json_schema'],['groq','openai/gpt-oss-20b','json_schema'],['groq','account-model','json_object'],['openai','openai/gpt-oss-120b','json_object']]) {
        await complete({providerId,model,systemPrompt:'Extract notes',userPrompt:'source',jsonMode:true,outputSchema:PACKET_OUTPUT_SCHEMA});
        const format=JSON.parse(requests.at(-1).body).response_format;
        assert.equal(format.type,expected);
        if(expected==='json_schema') {
            assert.equal(format.json_schema.strict,true);
            assert.deepEqual(format.json_schema.schema,PACKET_OUTPUT_SCHEMA);
        }
    }
});

test('file transcription uses correct formats, preserves mixed-language detection, and normalizes timestamps', async () => {
    const blob = new Blob(['audio'], {type: 'audio/wav'});
    for (const providerId of ['groq', 'openai', 'mistral', 'compatible']) {
        saveConfig({keys: {[providerId]: 'test-key'}, ...(providerId === 'compatible'
            ? {compatibleBaseUrl: 'https://custom.example/v1', models: {compatible: {transcription: 'whisper-custom'}}} : {})});
        globalThis.fetch = async (url, options) => {
            requests.push({url, ...options});
            return Response.json({text: 'Hindi and English', segments: [{id: 7, start: 0, end: 2, text: 'Hindi and English'}]});
        };
        const result = await transcribeAudio({providerId, blob, language: 'hi-en'});
        assert.deepEqual(result.segments, [{start: 0, end: 2, text: 'Hindi and English'}]);
        const body = requests.at(-1).body;
        assert.equal(body.get('file').name, 'chunk.wav');
        assert.equal(body.get('language'), null);
        if (providerId === 'groq' || providerId === 'openai') assert.equal(body.get('response_format'), 'verbose_json');
        if (providerId === 'mistral') assert.equal(body.get('timestamp_granularities[]'), 'segment');
    }
    await transcribeAudio({providerId: 'openai', model: 'gpt-4o-transcribe', blob, language: 'hi'});
    assert.equal(requests.at(-1).body.get('response_format'), 'json');
    assert.equal(requests.at(-1).body.get('language'), 'hi');
});

test('Gemini audio produces text without fabricated timestamps', async () => {
    saveConfig({keys: {gemini: 'test-key'}, models: {gemini: {transcription: 'audio-model'}}});
    const result = await transcribeAudio({providerId: 'gemini', blob: new Blob(['audio'], {type: 'audio/mp3'}), language: 'hi-en'});
    assert.deepEqual(result.segments, []);
    const body = JSON.parse(requests[0].body);
    assert.equal(body.messages[0].content[1].input_audio.format, 'mp3');
    assert.equal(atob(body.messages[0].content[1].input_audio.data), 'audio');
    await assert.rejects(transcribeAudio({providerId: 'gemini', blob: new Blob(['audio'], {type: 'audio/ogg'}), language: 'en'}), {kind: 'unsupported'});
});

test('Mistral requests timestamps without an incompatible forced language in all supported language modes', async () => {
    saveConfig({keys: {mistral: 'test-key'}});
    globalThis.fetch = async (url, options) => {
        requests.push({url, ...options});
        return Response.json({text: 'transcript', segments: []});
    };
    for (const language of ['en', 'hi', 'hi-en']) {
        await transcribeAudio({providerId: 'mistral', language, blob: new Blob(['a'], {type: 'audio/mp3'})});
        assert.equal(requests.at(-1).body.get('language'), null);
        assert.equal(requests.at(-1).body.get('timestamp_granularities[]'), 'segment');
    }
});

test('response body network interruptions are retryable while Gemini invalid-key errors are not', async () => {
    saveConfig({keys: {groq: 'test-key', gemini: 'test-key'}, models: {gemini: {completion: 'account-model'}}});
    globalThis.fetch = async () => new Response(new ReadableStream({start(controller) {controller.error(new TypeError('body connection lost'));}}));
    await assert.rejects(complete({systemPrompt: '', userPrompt: ''}), error => error.kind === 'network' && error.retryable);
    globalThis.fetch = async () => Response.json({error: {code: 400, details: [{reason: 'API_KEY_INVALID'}]}}, {status: 400});
    await assert.rejects(complete({providerId: 'gemini', systemPrompt: '', userPrompt: ''}), error => error.kind === 'auth' && !error.retryable);
});

test('unsupported capabilities, missing keys and missing models make no requests', async () => {
    assert.equal(getProviderCapabilities('anthropic').transcription, false);
    assert.equal(getProviderCapabilities('openrouter').transcription, false);
    assert.equal(getProviderCapabilities('groq').verifiedInference, false);
    assert.equal(getProviderCapabilities('compatible').verifiedBrowserAccess, false);
    await assert.rejects(transcribeAudio({providerId: 'anthropic'}), {kind: 'unsupported'});
    await assert.rejects(complete({providerId: 'groq', systemPrompt: '', userPrompt: ''}), {kind: 'auth'});
    saveConfig({keys: {openai: 'test-key'}});
    await assert.rejects(complete({providerId: 'openai', systemPrompt: '', userPrompt: ''}), {kind: 'unsupported'});
    assert.equal(requests.length, 0);
});

test('errors classify authentication, quota, rate limits and server failures without leaking bodies', async () => {
    saveConfig({keys: {groq: 'private-key'}});
    for (const [status, code, kind, retryable] of [[401, '', 'auth', false], [403, '', 'auth', false], [402, '', 'quota', false],
        [429, 'insufficient_quota', 'quota', false], [429, '', 'rate_limit', true], [503, '', 'network', true], [400, '', 'response', false], [404, '', 'unsupported', false]]) {
        globalThis.fetch = async () => Response.json({error: {code, message: 'private-key secret lecture text'}}, {status, headers: {'Retry-After': '3'}});
        await assert.rejects(complete({systemPrompt: '', userPrompt: 'secret lecture text'}), error => {
            assert(error instanceof ProviderError);
            assert.equal(error.kind, kind); assert.equal(error.retryable, retryable); assert.equal(error.status, status); assert.equal(error.retryAfterMs, 3000);
            assert(!JSON.stringify(error).includes('private-key')); assert(!error.message.includes('secret lecture'));
            return true;
        });
    }
    assert.equal(parseRetryAfter('Wed, 14 Oct 2026 15:00:02 GMT', Date.parse('2026-10-14T15:00:00Z')), 2000);
    assert.equal(parseRetryAfter('nonsense'), undefined);
});

test('malformed envelopes, JSON content, truncation, and timestamp data are rejected', async () => {
    saveConfig({keys: {groq: 'test-key'}});
    for (const response of [new Response('not JSON'), Response.json({choices: []}),
        Response.json({choices: [{message: {content: 'not JSON'}}]}),
        Response.json({choices: [{finish_reason: 'length', message: {content: '{}'}}]}),
        Response.json({choices: [{message: {content: '[]'}}]})]) {
        globalThis.fetch = async () => response;
        await assert.rejects(complete({systemPrompt: '', userPrompt: '', jsonMode: true}), {kind: 'response'});
    }
    globalThis.fetch = async () => Response.json({text: 'text', segments: [{start: 5, end: 2, text: 'bad'}]});
    await assert.rejects(transcribeAudio({blob: new Blob(['a'], {type: 'audio/mpeg'}), language: 'en'}), {kind: 'response'});
});

test('cancellation before and during fetch propagates AbortError; timeouts are retryable', async () => {
    saveConfig({keys: {groq: 'test-key'}});
    const before = new AbortController(); before.abort('do not expose this reason');
    await assert.rejects(complete({systemPrompt: '', userPrompt: '', signal: before.signal}), {name: 'AbortError'});
    assert.equal(requests.length, 0);
    globalThis.fetch = async (_, {signal}) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {once: true});
    });
    const during = new AbortController();
    const pending = complete({systemPrompt: '', userPrompt: '', signal: during.signal});
    during.abort();
    await assert.rejects(pending, {name: 'AbortError'});
    await assert.rejects(requestJSON('https://example.com', {providerId: 'groq', timeoutMs: 5}), error => error.kind === 'network' && error.retryable);
});

test('custom endpoints require secure URLs and changing one clears its old key', async () => {
    for (const url of ['http://remote.example/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/#secret']) assert.throws(() => validateBaseUrl(url));
    saveConfig({compatibleBaseUrl: 'https://first.example/v1', keys: {compatible: 'first-key'}, models: {compatible: {completion: 'custom-model'}}});
    await assert.rejects(complete({providerId: 'compatible', baseUrl: 'https://other.example/v1', systemPrompt: '', userPrompt: ''}), {kind: 'unsupported'});
    assert.equal(requests.length, 0);
    saveConfig({compatibleBaseUrl: 'https://second.example/v1'});
    assert.equal(getConfig().keys.compatible, '');
    await assert.rejects(complete({providerId: 'compatible', systemPrompt: '', userPrompt: ''}), {kind: 'auth'});
});

test('provider selections stay stable for an active operation after settings change', async () => {
    saveConfig({keys: {groq: 'groq-key', openai: 'openai-key'}, models: {openai: {completion: 'new-model'}}});
    const selection = getProviderSelection('completion');
    saveConfig({notesProvider: 'openai', models: {groq: {completion: 'changed-model'}}});
    await complete({...selection, systemPrompt: '', userPrompt: ''});
    assert.equal(JSON.parse(requests[0].body).model, 'openai/gpt-oss-120b');
    assert.equal(requests[0].headers.Authorization, 'Bearer groq-key');
});
afterEach(() => {globalThis.fetch = originalFetch;});

test('rate-limit message shows the provider retry delay without leaking response text', async () => {
    globalThis.fetch = async () => Response.json({error:{message:'private quota detail'}}, {status:429, headers:{'retry-after':'75'}});
    await assert.rejects(requestJSON('https://api.groq.com/openai/v1/chat/completions', {providerId:'groq'}), error => {
        assert.equal(error.retryAfterMs,75000);
        assert.match(error.message,/75 seconds/);
        assert(!error.message.includes('private quota detail'));
        return true;
    });
    globalThis.fetch = async () => Response.json({error:{code:'insufficient_quota'}}, {status:429});
    await assert.rejects(requestJSON('https://api.groq.com/openai/v1/chat/completions', {providerId:'groq'}), error => {
        assert.equal(error.kind,'quota');
        assert.match(error.message,/no remaining quota/);
        assert(!error.message.includes('Retry after'));
        return true;
    });
});

test('independent providers and unknown selection never fall back to Groq', async () => {
    saveConfig({keys: {groq: 'test-groq', openai: 'test-openai'}, notesProvider: 'openai', models: {openai: {completion: 'chosen-model'}}});
    assert.equal(getProviderSelection('transcription').providerId, 'groq');
    assert.equal(getProviderSelection('completion').providerId, 'openai');
    await complete({systemPrompt: 'Notes', userPrompt: 'Text', jsonMode: true});
    assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(requests[0].headers.Authorization, 'Bearer test-openai');
    await assert.rejects(complete({providerId: 'unknown', systemPrompt: '', userPrompt: 'Text'}), {kind: 'unsupported'});
    assert.equal(requests.length, 1);
});

test('404 and 413 identify the request stage without exposing provider text', async () => {
    for (const [status, expected] of [[404, /model was not found/], [413, /request is too large/]]) {
        globalThis.fetch = async () => Response.json({error: {message:'secret-key secret lecture'}}, {status});
        await assert.rejects(requestJSON('https://api.groq.com/openai/v1/audio/transcriptions', {providerId:'groq',body:'audio'}), error => {
            assert.equal(error.kind,'unsupported'); assert.equal(error.retryable,false);
            assert.match(error.message,new RegExp(`Groq transcription request failed \\(HTTP ${status}\\)`));
            assert.match(error.message,expected); assert(!error.message.includes('secret'));
            return true;
        });
    }
});
