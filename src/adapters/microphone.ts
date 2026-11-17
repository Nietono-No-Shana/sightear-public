import type { PcmRecording } from '../engine/ports';

export class PilotMicrophone {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private generation = 0;
  private chunks: Float32Array[] = [];
  private sampleCount = 0;
  private sampleRate = 48000;

  async open(): Promise<void> {
    this.stop();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('麦克风不可用，请用 localhost 或 HTTPS 打开');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); throw new Error('录音已取消'); }
    this.stream = stream;
    this.context = new AudioContext();
    try {
      await this.context.audioWorklet.addModule('/pilot-capture.js');
      await this.context.resume();
      if (generation !== this.generation) throw new Error('录音已取消');
    } catch (error) { this.stop(); throw error; }
  }

  listen(origin: number, receive: (samples: Float32Array, sampleRate: number, time: number) => void, failed: () => void, durationMs = 30000): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 120000) throw new RangeError('录入时长须在两分钟以内');
    const context = this.context;
    const stream = this.stream;
    if (!context || !stream) throw new Error('麦克风尚未就绪');
    const generation = this.generation;
    const offset = performance.now() - context.currentTime * 1000;
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, 'pilot-capture');
    const mute = context.createGain();
    mute.gain.value = 0;
    this.sampleRate = context.sampleRate;
    const sampleLimit = Math.ceil(context.sampleRate * durationMs / 1000);
    capture.port.onmessage = (event: MessageEvent<{ samples: Float32Array; chunk: Float32Array; end: number }>) => {
      if (generation !== this.generation) return;
      const samples = event.data.samples;
      const chunk = event.data.chunk;
      const start = Math.round((offset + event.data.end * 1000 - origin) * context.sampleRate / 1000) - chunk.length;
      const from = Math.max(0, -start, this.sampleCount - start);
      if (from < chunk.length && this.sampleCount < sampleLimit) {
        const gap = Math.min(sampleLimit - this.sampleCount, Math.max(0, start + from - this.sampleCount));
        if (gap) { this.chunks.push(new Float32Array(gap)); this.sampleCount += gap; }
        const part = chunk.slice(from, from + Math.max(0, sampleLimit - this.sampleCount));
        this.chunks.push(part); this.sampleCount += part.length;
      }
      const time = offset + event.data.end * 1000 - samples.length / context.sampleRate * 500 - origin;
      if (time >= 0) receive(samples, context.sampleRate, time);
    };
    capture.onprocessorerror = failed;
    stream.getTracks().forEach((track) => { track.onended = () => { if (generation === this.generation) failed(); }; });
    source.connect(capture);
    capture.connect(mute);
    mute.connect(context.destination);
  }

  stop(): void {
    this.generation += 1;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.chunks = []; this.sampleCount = 0;
  }

  takeRecording(): PcmRecording | null {
    if (!this.sampleCount) return null;
    const samples = new Float32Array(this.sampleCount);
    let offset = 0;
    for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length; }
    this.chunks = []; this.sampleCount = 0;
    return { sampleRate: this.sampleRate, samples };
  }
}
