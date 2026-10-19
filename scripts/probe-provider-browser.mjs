// Connectivity only: synthetic invalid keys, empty requests, no user data or paid inference.
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const {chromium} = await import(pathToFileURL(process.argv[2]));
const server = createServer((request, response) => response.end('<!doctype html><title>Provider connectivity probe</title>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({headless: true, executablePath: process.argv[3]});
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const results = await page.evaluate(async () => {
        const targets = [
            ['groq', 'completion', 'https://api.groq.com/openai/v1/chat/completions'],
            ['groq', 'transcription', 'https://api.groq.com/openai/v1/audio/transcriptions'],
            ['openai', 'completion', 'https://api.openai.com/v1/chat/completions'],
            ['openai', 'transcription', 'https://api.openai.com/v1/audio/transcriptions'],
            ['gemini', 'completion', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
            ['openrouter', 'completion', 'https://openrouter.ai/api/v1/chat/completions'],
            ['mistral', 'completion', 'https://api.mistral.ai/v1/chat/completions'],
            ['mistral', 'transcription', 'https://api.mistral.ai/v1/audio/transcriptions'],
            ['anthropic', 'completion', 'https://api.anthropic.com/v1/messages'],
        ];
        return Promise.all(targets.map(async ([provider, capability, url]) => {
            const headers = provider === 'anthropic'
                ? {'x-api-key': 'delectured-invalid-probe-key', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'}
                : {Authorization: 'Bearer delectured-invalid-probe-key'};
            let body = '{}';
            if (capability === 'transcription') { body = new FormData(); body.append('model', 'invalid-probe-model'); }
            else headers['Content-Type'] = 'application/json';
            try {
                const response = await fetch(url, {method: 'POST', headers, body, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000)});
                return {provider, capability, readable: response.type !== 'opaque', status: response.status};
            } catch { return {provider, capability, readable: false, status: null}; }
        }));
    });
    const report = {checkedAt: new Date().toISOString(), method: 'Chromium localhost origin; invalid credentials; no inference verification', results};
    await writeFile('docs/provider-browser-probe.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
