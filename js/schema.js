/** Versioned, text-only permanent lecture format. Unknown fields are never persisted. */
import {PROVIDER_IDS} from './providers/catalog.js';
import {validateStudyFields, validateCheckpoint} from './analysis-schema.js';
import {validateProcessingIssue} from './processing-flow.js';
export const SCHEMA_VERSION = 2;
export const LANGUAGES = ['en', 'hi', 'hi-en'];
export const LECTURE_STATES = ['recording', 'processing', 'ready', 'interrupted', 'failed'];
const ANALYSIS_STATES = ['pending', 'processing', 'ready', 'partial', 'failed'];
function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
    return value;
}
function string(value, name, fallback = '') {
    if (value === undefined) return fallback;
    if (typeof value !== 'string') throw new TypeError(`${name} must be text.`);
    return value;
}
function number(value, name, fallback = 0) {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative number.`);
    return value;
}
function choice(value, values, name, fallback) {
    value ??= fallback;
    if (!values.includes(value)) throw new TypeError(`Invalid ${name}.`);
    return value;
}
function date(value, fallback) {
    value ??= fallback;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new TypeError('Invalid lecture date.');
    return new Date(value).toISOString();
}
function array(value, name, transform) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
    return value.map(transform);
}
export function validateSegments(value) {
    return array(value, 'segments', segment => {
        object(segment, 'segment');
        const start = number(segment.start, 'segment start');
        const end = number(segment.end, 'segment end', start);
        if (end < start) throw new TypeError('Segment ends before it starts.');
        return {start, end, text: string(segment.text, 'segment text')};
    });
}
export function validateAnalysis(value = {}) {
    object(value, 'analysis');
    const result = {
        summary: string(value.summary, 'summary'),
        topics: array(value.topics, 'topics', item => string(item, 'topic')),
        concepts: array(value.concepts, 'concepts', item => {
            object(item, 'concept');
            return {term: string(item.term, 'term'), definition: string(item.definition, 'definition')};
        }),
        flashcards: array(value.flashcards, 'flashcards', item => {
            object(item, 'flashcard');
            return {q: string(item.q, 'question'), a: string(item.a, 'answer')};
        }),
        examSignals: array(value.examSignals, 'exam signals', item => string(item, 'exam signal')),
        scores: {},
    };
    if (value.scores !== undefined) {
        object(value.scores, 'scores');
        for (const key of ['clarity', 'density', 'pace']) {
            if (value.scores[key] !== undefined) {
                const score = number(value.scores[key], key);
                if (score > 100) throw new TypeError('Scores must be between 0 and 100.');
                result.scores[key] = score;
            }
        }
    }
    return {...result, ...validateStudyFields(value)};
}
export function validateLecture(value, now = new Date().toISOString()) {
    object(value, 'lecture');
    if (value.schemaVersion !== undefined && ![1, SCHEMA_VERSION].includes(value.schemaVersion)) throw new TypeError('Unsupported lecture schema version.');
    const id = string(value.id, 'lecture ID');
    if (!id.trim()) throw new TypeError('Lecture ID is required.');
    const createdAt = date(value.createdAt ?? value.date, now);
    const legacyAnalysis = ['summary', 'topics', 'concepts', 'scores', 'examSignals', 'flashcards'].some(key => Object.hasOwn(value, key));
    const hasAnalysis = value.analysis !== undefined || legacyAnalysis;
    return {
        id, schemaVersion: SCHEMA_VERSION, title: string(value.title, 'title', 'Untitled'),
        createdAt, updatedAt: date(value.updatedAt, createdAt),
        language: choice(value.language, LANGUAGES, 'language', 'en'),
        status: choice(value.status, LECTURE_STATES, 'lecture state', hasAnalysis ? 'ready' : 'interrupted'),
        durationMs: number(value.durationMs, 'duration'), transcript: string(value.transcript, 'transcript'),
        captureGaps: array(value.captureGaps, 'capture gaps', gap => {
            object(gap, 'capture gap');
            return {atMs: number(gap.atMs, 'gap time'), reason: choice(gap.reason,
                ['suspended', 'microphone', 'processor', 'encoder', 'storage', 'encoding-backlog', 'page-hidden', 'flush-timeout', 'reload', 'upload-incomplete'], 'gap reason'),
                durationMs: gap.durationMs == null ? null : number(gap.durationMs, 'gap duration')};
        }),
        transcriptSource: choice(value.transcriptSource, ['legacy', 'chunks', 'assembled'], 'transcript source',
            value.transcript ? 'legacy' : 'chunks'),
        segments: validateSegments(value.segments), analysis: validateAnalysis(value.analysis ?? (legacyAnalysis ? value : {})),
        analysisStatus: choice(value.analysisStatus, ANALYSIS_STATES, 'analysis state', hasAnalysis ? 'ready' : 'pending'),
        ...(value.analysisCheckpoint ? {analysisCheckpoint: validateCheckpoint(value.analysisCheckpoint)} : {}),
        ...(value.uploadSource ? {uploadSource: validateUploadSource(value.uploadSource)} : {}),
        ...(value.processingIssue ? {processingIssue: validateProcessingIssue(value.processingIssue)} : {}),
        ...(value.providerSelections ? {providerSelections: validateProviderSelections(value.providerSelections)} : {}),
    };
}
function validateUploadSource(value) {
    object(value, 'upload source');
    const fingerprint = string(value.fingerprint, 'source fingerprint');
    if (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) throw new TypeError('Invalid source fingerprint.');
    if (typeof value.complete !== 'boolean') throw new TypeError('Invalid upload completion.');
    return {fingerprint, complete:value.complete};
}
function validateProviderSelections(value) {
    object(value, 'provider selections');
    const result = {};
    for (const capability of ['transcription', 'completion']) {
        const selection = object(value[capability], 'provider selection');
        result[capability] = {
            providerId: choice(selection.providerId, PROVIDER_IDS, 'provider ID'),
            model: string(selection.model, 'model ID'),
            baseUrl: string(selection.baseUrl, 'provider URL'),
        };
    }
    return result;
}
export function validateChunk(value) {
    object(value, 'chunk');
    const lectureId = string(value.lectureId, 'lecture ID');
    const index = value.index ?? value.chunkIndex;
    if (!lectureId.trim() || !Number.isSafeInteger(index) || index < 0) throw new TypeError('Invalid chunk identity.');
    const result = {
        id: `${lectureId}_${index}`, lectureId, index,
        startMs: number(value.startMs, 'chunk start'), durationMs: number(value.durationMs, 'chunk duration'), overlapMs: number(value.overlapMs, 'overlap'),
        status: choice(value.status, ['pending', 'processing', 'transcribed', 'failed'], 'chunk state', 'pending'),
        attempts: number(value.attempts, 'attempts'), nextAttemptAt: number(value.nextAttemptAt, 'retry time'), segments: validateSegments(value.segments),
    };
    if (value.text !== undefined) result.text = string(value.text, 'chunk text');
    if (value.error !== undefined) result.error = string(value.error, 'chunk error');
    if (result.status === 'transcribed' && result.text === undefined) throw new TypeError('Transcribed chunks require text.');
    if (value.blob !== undefined && result.status !== 'transcribed') {
        if (!(value.blob instanceof Blob)) throw new TypeError('Audio must be a Blob.');
        result.blob = value.blob;
    }
    if (result.status !== 'transcribed' && !result.blob) throw new TypeError('Unfinished chunks require recoverable audio.');
    return result;
}
export function createBackup(lectures) {
    return {format: 'delectured', schemaVersion: SCHEMA_VERSION, lectures: lectures.map(value => validateLecture(value))};
}
export function parseBackup(value) {
    if (!Array.isArray(value)) {
        object(value, 'backup');
        if (value.format !== 'delectured' || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.lectures)) throw new TypeError('Unsupported backup format.');
        value = value.lectures;
    }
    const lectures = value.map(item => validateLecture(item));
    if (new Set(lectures.map(item => item.id)).size !== lectures.length) throw new TypeError('Duplicate lecture IDs in backup.');
    return lectures;
}
