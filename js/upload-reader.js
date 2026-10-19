import {Input, BlobSource, ALL_FORMATS, AudioSampleSink} from './vendor/mediabunny/mediabunny.js';
import {throwIfAborted} from './providers/http.js';

// BlobSource reads lazily. Never create an ArrayBuffer for the complete file.
export async function openUpload(file, signal) {
    const input = new Input({source: new BlobSource(file), formats: ALL_FORMATS});
    const cancel = () => input.dispose();
    signal?.addEventListener('abort', cancel, {once: true});
    const close = () => {signal?.removeEventListener('abort', cancel); input.dispose();};
    try {
        throwIfAborted(signal);
        const track = await input.getPrimaryAudioTrack();
        if (!track || !await track.canDecode()) throw new Error('Unsupported audio codec');
        const sampleRate = await track.getSampleRate(), channels = await track.getNumberOfChannels();
        const origin = await track.getFirstTimestamp(), end = await track.computeDuration();
        const sink = new AudioSampleSink(track);
        return {seconds: end - origin, sampleRate, channels, close,
            async *samples(startSeconds = 0) {
                for await (const sample of sink.samples(origin + startSeconds)) {
                    try {
                        throwIfAborted(signal);
                        yield {audio: sample.toAudioBuffer(), timestamp: sample.timestamp - origin};
                    } finally {sample.close();}
                }
            }};
    } catch (error) {close(); throwIfAborted(signal); throw error;}
}

// Native band-limited resampling of bounded mono blocks, not the full lecture.
export async function resampleUpload(pcm, fromRate, toRate) {
    if (fromRate === toRate) return pcm;
    const context = new OfflineAudioContext(1, Math.round(pcm.length * toRate / fromRate), toRate);
    const buffer = context.createBuffer(1, pcm.length, fromRate);
    buffer.copyToChannel(pcm, 0);
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
    return (await context.startRendering()).getChannelData(0);
}
