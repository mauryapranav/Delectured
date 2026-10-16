import {chatCompletion, fileTranscription} from './openai-compatible.js';
export const complete = chatCompletion;
export const transcribeAudio = request => fileTranscription(request, {style: 'json'});
