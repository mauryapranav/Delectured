class RecorderWorklet extends AudioWorkletProcessor {
    constructor() {
        super(); this.buffer = new Float32Array(2048); this.length = 0; this.stopped = false;
        this.port.onmessage = event => {
            if (event.data.type === 'flush') {
                this.stopped = true; this.send(); this.port.postMessage({type: 'flushed'});
            }
        };
    }
    send() {
        if (!this.length) return;
        const samples = this.buffer.slice(0, this.length);
        this.port.postMessage({type: 'samples', samples}, [samples.buffer]); this.length = 0;
    }
    process(inputs) {
        if (this.stopped) return false;
        const channels = inputs[0];
        if (channels?.length) {
            for (let i = 0; i < channels[0].length; i++) {
                let value = 0; for (const channel of channels) value += channel[i];
                this.buffer[this.length++] = value / channels.length;
                if (this.length === this.buffer.length) this.send();
            }
        }
        return true; // Unwritten outputs are silent: no microphone playback.
    }
}
registerProcessor('recorder-worklet', RecorderWorklet);
