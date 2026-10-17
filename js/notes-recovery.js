import * as store from './store.js';
import {validateProviderConfiguration, getProviderSelection} from './providers/index.js';
import {getProviderMetadata} from './providers/catalog.js';

export async function refreshNotesSelection(id, storage = store, {reset = false} = {}) {
    const completion = validateProviderConfiguration('completion');
    const lecture = await storage.getLecture(id);
    if (!lecture) throw new Error('Recording no longer exists.');
    const previous = lecture.providerSelections?.completion;
    const changed = !previous || ['providerId', 'model', 'baseUrl'].some(key => previous[key] !== completion[key]);
    // Match Queue's legacy audio fallback; notes must not require a new audio configuration.
    const transcription = lecture.providerSelections?.transcription ?? getProviderSelection('transcription', {
        providerId: 'groq', model: getProviderMetadata('groq').defaults.transcription,
    });
    await storage.updateLecture(id, {
        providerSelections: {transcription, completion},
        ...(changed || reset ? {analysisCheckpoint: undefined} : {}),
    });
}
