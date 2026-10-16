import * as store from './store.js';
import {validateProviderConfiguration} from './providers/index.js';

export async function refreshNotesSelection(id, storage = store) {
    const completion = validateProviderConfiguration('completion');
    const lecture = await storage.getLecture(id);
    if (!lecture) throw new Error('Recording no longer exists.');
    await storage.updateLecture(id, {
        providerSelections: {...lecture.providerSelections, completion},
        analysisCheckpoint: undefined,
    });
}
