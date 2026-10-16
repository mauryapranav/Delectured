export const CAPTURE_DEFAULTS = Object.freeze({sampleRate: 16000, targetMs: 300000, maxExtraMs: 15000, quietMs: 400, overlapMs: 2000, threshold: 0.01});

export class PCMChunker {
    constructor(onChunk, options = {}) {
        Object.assign(this, CAPTURE_DEFAULTS, options);
        if (![this.sampleRate, this.targetMs, this.quietMs].every(n => Number.isFinite(n) && n > 0) || this.overlapMs < 0 || this.overlapMs >= this.targetMs || this.maxExtraMs < 0) throw new TypeError('Invalid audio boundaries.');
        this.onChunk = onChunk; this.target = Math.ceil(this.targetMs * this.sampleRate / 1000);
        this.maximum = Math.ceil((this.targetMs + this.maxExtraMs) * this.sampleRate / 1000);
        this.buffer = new Float32Array(this.maximum); this.length = 0; this.totalSamples = 0;
        this.startSample = 0; this.overlapSamples = 0; this.quietSamples = 0; this.index = 0;
    }
    push(samples) {
        for (const sample of samples) {
            this.buffer[this.length++] = sample; this.totalSamples++;
            this.quietSamples = Math.abs(sample) < this.threshold ? this.quietSamples + 1 : 0;
            if (this.length >= this.target && this.quietSamples >= this.quietMs * this.sampleRate / 1000) this.cut(false);
            else if (this.length >= this.maximum) this.cut(true);
        }
    }
    cut(hard) {
        if (this.length <= this.overlapSamples) return;
        const pcmData = this.buffer.slice(0, this.length);
        const chunk = {index: this.index++, startMs: this.startSample / this.sampleRate * 1000,
            durationMs: this.length / this.sampleRate * 1000, overlapMs: this.overlapSamples / this.sampleRate * 1000, pcmData, sampleRate: this.sampleRate};
        const overlap = hard ? Math.min(Math.floor(this.overlapMs * this.sampleRate / 1000), this.length) : 0;
        this.buffer.copyWithin(0, this.length - overlap, this.length);
        this.startSample += this.length - overlap; this.length = overlap; this.overlapSamples = overlap; this.quietSamples = 0;
        this.onChunk(chunk);
    }
    flush() {this.cut(false); this.length = 0; this.overlapSamples = 0;}
    clear() {this.buffer = new Float32Array(0); this.length = 0;}
}
