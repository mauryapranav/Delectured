import {parseStudyJSON} from '../study-json.js';
import {rejectionReason, bodyRetryDelay} from './diagnostics.js';
export class ProviderError extends Error {
    constructor(kind, message, {providerId, status, retryAfterMs, rejection, networkReason, retryable = false} = {}) {
        super(message);
        this.name = 'ProviderError';
        Object.assign(this, {kind, providerId, status, retryAfterMs, rejection, networkReason, retryable});
    }
}
export function aborted() { return new DOMException('Request cancelled.', 'AbortError'); }
export function throwIfAborted(signal) { if (signal?.aborted) throw aborted(); }
export function parseRetryAfter(value, now = Date.now()) {
    if (!value) return undefined;
    const seconds = Number(value);
    const result = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    return Number.isFinite(result) ? Math.max(0, result) : undefined;
}

// Raw bodies, keys, URLs and prompts never become error messages or diagnostic fields.
export async function requestJSON(url, {providerId, headers, body, signal, timeoutMs = 120000, method = 'POST', beforeRequest, onUsage}) {
    throwIfAborted(signal);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ProviderError('unsupported', 'Invalid request timeout.', {providerId});
    await beforeRequest?.();
    throwIfAborted(signal);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, {once: true});
    let timedOut = false;
    const timer = setTimeout(() => {timedOut = true; controller.abort();}, timeoutMs);
    try {
        const response = await fetch(url, {method, headers, body, signal: controller.signal,
            credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer'});
        let data;
        // Read failures are network errors; only JSON syntax failures are response errors.
        const responseText = await response.text();
        try { data = JSON.parse(responseText); }
        catch {
            throwIfAborted(signal);
            if (timedOut) throw new ProviderError('network', 'The provider request timed out.', {providerId, networkReason:'timeout', retryable: true});
            if (response.ok) throw new ProviderError('response', 'The provider returned an unreadable response.', {providerId});
        }
        throwIfAborted(signal);
        const status = response.status;
        if (!response.ok || data?.error) {
            const code = String(data?.error?.code ?? data?.error?.type ?? '').toLowerCase();
            const invalidGoogleKey = Array.isArray(data?.error?.details) && data.error.details.some(detail => detail?.reason === 'API_KEY_INVALID');
            let kind = 'response';
            if (status === 401 || status === 403 || invalidGoogleKey) kind = 'auth';
            else if (status === 402 || ['insufficient_quota', 'quota_exceeded', 'billing_hard_limit_reached'].includes(code)) kind = 'quota';
            else if (status === 429) kind = 'rate_limit';
            else if (status === 404 || status === 413) kind = 'unsupported';
            else if (status >= 500) kind = 'network';
            const messages = {auth: 'The provider rejected the API key or access permissions.', quota: 'The provider account has no remaining quota or credit.',
                rate_limit: 'The provider rate limit was reached. Retry after the indicated delay.', unsupported: 'The provider does not support this endpoint, model, or request size.',
                network: 'The provider is temporarily unavailable.', response: 'The provider rejected the request. Check the selected model and its supported parameters.'};
            // Show only fixed diagnostic labels, never provider bodies or user input.
            const names = {groq:'Groq',openai:'OpenAI',gemini:'Gemini',openrouter:'OpenRouter',mistral:'Mistral',anthropic:'Anthropic',compatible:'Custom provider'};
            const path = new URL(url).pathname;
            const stage = path.endsWith('/audio/transcriptions') ? 'transcription' : path.endsWith('/chat/completions') || path.endsWith('/messages') ? 'notes/answer' : 'API';
            let message = messages[kind];
            const retryAfterMs = parseRetryAfter(response.headers.get('retry-after')) ?? bodyRetryDelay(data);
            if (kind === 'rate_limit') message = `The provider rate limit was reached. ${retryAfterMs === undefined ? 'The provider did not supply a retry delay; check your account limits before retrying.' : `Retry after at least ${Math.ceil(retryAfterMs / 1000)} seconds.`}`;
            if (status === 404) message = 'The endpoint or model was not found. Check the selected model ID and your access to it in Settings.';
            if (status === 413) message = 'The request is too large for this provider or account. Reduce the audio chunk or text context size; retrying the same request will not help.';
            message = `${names[providerId] || 'Provider'} ${stage} request failed (HTTP ${status}). ${message}`;
            throw new ProviderError(kind, message, {providerId, status, retryAfterMs, rejection: status === 400 ? rejectionReason(data) : undefined,
                retryable: kind === 'rate_limit' || kind === 'network'});
        }
        await onUsage?.(data?.usage);
        return data;
    } catch (error) {
        throwIfAborted(signal);
        if (error instanceof ProviderError || ['storage','budget'].includes(error.kind)) throw error;
        throw new ProviderError('network', timedOut ? 'The provider request timed out.' : 'Could not reach the provider. Check the connection and browser access support.', {providerId, networkReason:timedOut?'timeout':'connection', retryable: true});
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}

export function normalizeText(text, {providerId, jsonMode = false} = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new ProviderError('response', 'The provider returned no usable text.', {providerId});
    if (jsonMode) {
        try {return JSON.stringify(parseStudyJSON(text));}
        catch (cause) {throw Object.assign(new ProviderError('response', 'The provider did not return the requested JSON object.', {providerId}), {outputIssue:cause.outputIssue});}
    }
    return text;
}
export function normalizeTranscript(data, providerId) {
    if (typeof data?.text !== 'string') throw new ProviderError('response', 'The provider returned no transcript.', {providerId});
    const segments = data.segments ?? [];
    if (!Array.isArray(segments) || segments.some(s => !s || typeof s.text !== 'string' || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end < s.start)) {
        throw new ProviderError('response', 'The provider returned invalid transcript timestamps.', {providerId});
    }
    return {text: data.text, segments: segments.map(({start, end, text}) => ({start, end, text}))};
}
