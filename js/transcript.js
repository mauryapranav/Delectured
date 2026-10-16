const normalized = text => text.trim().replace(/\s+/gu, ' ');
function stripPrefix(text, prefix) {
    const words = [...text.matchAll(/\S+/gu)], wanted = prefix.split(' ');
    if (words.length < wanted.length || words.slice(0, wanted.length).map(w => w[0]).join(' ') !== prefix) return null;
    const last = words[wanted.length - 1], remainder = text.slice(last.index + last[0].length);
    // Newlines and following indentation may be code, not disposable spacing.
    return /^[ \t]*[\r\n]/u.test(remainder) ? remainder : remainder.replace(/^[ \t]+/u, '');
}
export function assembleTranscript(chunks, {captureGaps = []} = {}) {
    const sorted = [...chunks].sort((a, b) => a.index - b.index), sources = [], segments = [], warnings = [], gaps = [...captureGaps];
    let previous;
    const indexes = new Set();
    for (const chunk of sorted) {
        if (!Number.isSafeInteger(chunk.index) || indexes.has(chunk.index)) throw new TypeError('Duplicate or invalid capture index.');
        indexes.add(chunk.index);
        if (!previous && chunk.index > 0) gaps.push({atMs: 0, durationMs: chunk.startMs || null, reason: 'missing-chunk'});
        if (previous && chunk.index !== previous.index + 1) gaps.push({atMs: chunk.startMs ?? 0, durationMs: null, reason: 'missing-chunk'});
        else if (previous?.durationMs > 0 && chunk.startMs > previous.startMs + previous.durationMs + 1) gaps.push({atMs: previous.startMs + previous.durationMs, durationMs: chunk.startMs - previous.startMs - previous.durationMs, reason: 'missing-audio'});
        if (chunk.status !== 'transcribed') {gaps.push({atMs: chunk.startMs ?? 0, durationMs: chunk.durationMs ?? null, reason: 'unfinished-chunk'}); previous = chunk; continue;}
        if (typeof chunk.text !== 'string') throw new TypeError('Missing transcript text.');
        let text = chunk.text;
        const timed = Number.isFinite(chunk.startMs) && chunk.startMs >= 0 && chunk.durationMs > 0;
        let local = timed ? (chunk.segments ?? []).filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end >= s.start && s.end <= chunk.durationMs / 1000 + .1 && typeof s.text === 'string') : [];
        if (local.some((s, i) => i && (s.start < local[i - 1].start || s.end < local[i - 1].end))) local = [];
        const originalLocal = local;
        if (local.length !== (chunk.segments ?? []).length) warnings.push(`Some timestamps in chunk ${chunk.index + 1} could not be validated.`);
        const overlap = previous?.status === 'transcribed' && previous.index + 1 === chunk.index && timed
            ? Math.min(chunk.overlapMs ?? 0, previous.startMs + previous.durationMs - chunk.startMs) / 1000 : 0;
        if (chunk.overlapMs > 0) {
            let removed = false;
            if (overlap > 0 && local.length && previous?.segments?.length) {
                const prefix = local.filter(s => s.end <= overlap + .01);
                const tail = previous.segments.filter(s => s.start + previous.startMs / 1000 >= chunk.startMs / 1000 - .01 && s.end <= previous.durationMs / 1000 + .1);
                // Require matching text AND aligned timestamps inside the actual overlap.
                for (let n = prefix.length; n > 0 && !removed; n--) {
                    const head = prefix.slice(0, n), candidate = normalized(head.map(s => s.text).join(' '));
                    if (!candidate) continue;
                    for (let m = tail.length; m > 0; m--) {
                        const end = tail.slice(-m);
                        if (normalized(end.map(s => s.text).join(' ')) !== candidate || normalized(previous.text).split(' ').slice(-candidate.split(' ').length).join(' ') !== candidate) continue;
                        if (Math.abs(end[0].start + previous.startMs / 1000 - head[0].start - chunk.startMs / 1000) > .35 ||
                            Math.abs(end.at(-1).end + previous.startMs / 1000 - head.at(-1).end - chunk.startMs / 1000) > .35) continue;
                        const remainder = stripPrefix(text, candidate);
                        if (remainder !== null) {text = remainder; local = local.slice(n); removed = true; break;}
                    }
                }
            }
            if (!removed) warnings.push(`Possible overlap in chunk ${chunk.index + 1} was retained because duplication could not be established.`);
        }
        const absolute = local.map(s => ({start: s.start + chunk.startMs / 1000, end: s.end + chunk.startMs / 1000, text: s.text}));
        sources.push({id: `chunk-${chunk.index}`, text, segments: absolute}); segments.push(...absolute); previous = {...chunk, segments: originalLocal};
    }
    if (gaps.length) warnings.push('The transcript contains interrupted or missing audio; gap duration may be unknown.');
    return {text: sources.map(s => s.text).filter(Boolean).join('\n\n'), sources, segments, gaps, warnings: [...new Set(warnings)]};
}
