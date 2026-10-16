import {chatCompletion, fileTranscription} from './openai-compatible.js';
export const complete = chatCompletion;
export function transcribeAudio(request) {
    return fileTranscription(request, {style: request.model === 'whisper-1' ? 'whisper' : 'json'});
}
