class PilotCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.window = new Float32Array(2048);
    this.filled = 0;
    this.sinceSend = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    this.window.copyWithin(0, channel.length);
    this.window.set(channel, this.window.length - channel.length);
    this.filled += channel.length;
    this.sinceSend += channel.length;
    if (this.filled >= this.window.length && this.sinceSend >= 1024) {
      this.port.postMessage({ samples: this.window.slice(), chunk: this.window.slice(-this.sinceSend), end: currentTime + channel.length / sampleRate });
      this.sinceSend = 0;
    }
    return true;
  }
}

registerProcessor('pilot-capture', PilotCapture);
