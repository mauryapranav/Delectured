export const jsonProblems = {
    malformed_json: 'The AI response contains broken JSON syntax.',
    wrong_root: 'The AI returned a list or a single value instead of a notes object.',
    empty_json: 'The AI returned no notes text.',
};
export function parseStudyJSON(text) {
    const fail = code => {throw Object.assign(new SyntaxError('The response was invalid JSON.'), {outputIssue:code});};
    if (typeof text !== 'string' || !text.trim()) return fail('empty_json');
    let candidate = text.trim();
    // Only remove a single complete outer fence; do not extract fragments or
    // guess missing punctuation, quotes, braces, or truncated content.
    const fenced = candidate.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
    if (fenced) candidate = fenced[1].trim();
    let value;
    try {value = JSON.parse(candidate);} catch {return fail('malformed_json');}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('wrong_root');
    return value;
}
