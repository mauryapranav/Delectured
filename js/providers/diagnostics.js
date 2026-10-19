// Provider text is inspected only to choose fixed labels; it is never persisted.
export const rejectionLabels = {
    schema: 'The provider rejected the structured notes format.',
    model: 'The provider rejected the selected model or its access settings.',
    context: 'The provider rejected the amount of text in this request.',
    parameter: 'The provider rejected a request parameter.',
};
export function rejectionReason(data) {
    const error = data?.error;
    const text = [error?.message, error?.param, ...(Array.isArray(error?.details) ? error.details.flatMap(d =>
        Array.isArray(d?.fieldViolations) ? d.fieldViolations.map(v => v?.field) : []) : [])].filter(x => typeof x === 'string').join(' ').slice(0, 16000);
    if (/response[_ .]?format|json[_ .]?schema|response[_ .]?schema|generationConfig\.response|schema.*(?:unsupported|invalid|complex)|(?:unsupported|invalid).*schema/i.test(text)) return 'schema';
    if (/context[_ ]length|maximum.*tokens|token.*limit|request.*too large/i.test(text)) return 'context';
    if (/model.*(?:not found|not supported|unsupported|access)|(?:unknown|invalid).*model/i.test(text)) return 'model';
    if (/unsupported parameter|unknown field|invalid argument/i.test(text)) return 'parameter';
}
export function bodyRetryDelay(data) {
    const details = data?.error?.details;
    if (!Array.isArray(details)) return undefined;
    const delays = details.filter(d => d?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo')
        .map(d => typeof d.retryDelay === 'string' && /^\d+(?:\.\d+)?s$/.test(d.retryDelay) ? Number(d.retryDelay.slice(0,-1))*1000 : NaN)
        .filter(n => Number.isFinite(n) && n >= 0 && n <= 86400000);
    return delays.length ? Math.max(...delays) : undefined;
}
