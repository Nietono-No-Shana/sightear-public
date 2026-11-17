import type { AudioOut, Millis, SoundEvent, TimbreId } from '../engine/ports';
import { PianoSampler } from './piano-sampler';

const LOOKAHEAD_SEC = 0.02;

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function waveformFor(timbre: TimbreId): OscillatorType {
  switch (timbre) {
    case 'piano':
      return 'triangle';
    case 'strings':
      return 'sawtooth';
    case 'synth':
      return 'square';
    case 'organ':
      return 'sine';
  }
}

function clampVelocity(velocity: number): number {
  return Math.max(0, Math.min(1, velocity));
}

export class WebAudioOut implements AudioOut {
  private context: AudioContext | null = null;
  /** 所有声部共用的总线；压缩器只兜住和弦叠加，不改变单音音量。 */
  private output: AudioNode | null = null;
  private piano: PianoSampler | null = null;
  private pianoWanted = false;
  private readonly voices = new Set<OscillatorNode>();

  stop(): void {
    for (const voice of this.voices) {
      try { voice.stop(); } catch {}
      voice.disconnect();
    }
    this.voices.clear();
    this.piano?.stop();
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.output = null;
    this.piano = null;
    this.pianoWanted = false;
  }

  /** 提前开始取采样；未切到钢琴时不做任何事。 */
  prime(timbre: TimbreId): Promise<void> {
    this.ensureContext();
    const piano = this.piano;
    if (timbre !== 'piano' || piano === null) return Promise.resolve();
    this.pianoWanted = true;
    return piano.prime();
  }

  private track(oscillator: OscillatorNode, gain: GainNode): void {
    this.voices.add(oscillator);
    oscillator.onended = () => {
      this.voices.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  private ensureContext(): AudioContext {
    if (this.context === null) {
      const context = new AudioContext();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.25;
      compressor.connect(context.destination);
      this.context = context;
      this.output = compressor;
      this.piano = new PianoSampler(context, compressor);
    }
    return this.context;
  }

  async resume(): Promise<void> {
    const context = this.ensureContext();
    if (context.state === 'suspended') {
      await context.resume();
    }
    if (this.pianoWanted) {
      await this.piano?.prime();
    }
  }

  now(): Millis {
    return this.context === null ? 0 : this.context.currentTime * 1000;
  }

  schedule(events: readonly SoundEvent[], origin: Millis): void {
    const context = this.ensureContext();
    const base = Math.max(origin / 1000, context.currentTime + LOOKAHEAD_SEC);

    for (const event of events) {
      const when = base + event.start / 1000;

      switch (event.kind) {
        case 'note': {
          const dur = Math.max(0.03, event.dur / 1000);
          this.playNote(context, when, dur, event.midi, event.velocity, event.timbre);
          break;
        }
        case 'chord': {
          const dur = Math.max(0.03, event.dur / 1000);
          for (const midi of event.midis) {
            this.playNote(context, when, dur, midi, 0.8, event.timbre);
          }
          break;
        }
        case 'click':
          this.playClick(context, when, event.accent === true);
          break;
      }
    }
  }

  private playNote(
    context: AudioContext,
    when: number,
    dur: number,
    midi: number,
    velocity: number,
    timbre: TimbreId,
  ): void {
    if (timbre === 'piano') {
      const piano = this.piano;
      if (piano !== null && piano.ready && piano.play(when, dur, midi, velocity)) return;
      if (piano !== null && !piano.unavailable) void this.prime('piano');
    }
    this.playTone(context, when, dur, midi, velocity, timbre);
  }

  private playTone(
    context: AudioContext,
    when: number,
    dur: number,
    midi: number,
    velocity: number,
    timbre: TimbreId,
  ): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const peak = Math.max(0.0002, clampVelocity(velocity) * 0.18);

    oscillator.type = waveformFor(timbre);
    oscillator.frequency.setValueAtTime(midiToHz(midi), when);

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(peak * 0.35, when + Math.min(dur * 0.8, 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    oscillator.connect(gain);
    this.track(oscillator, gain);
    gain.connect(this.output ?? context.destination);
    oscillator.start(when);
    oscillator.stop(when + dur + 0.02);
  }

  private playClick(context: AudioContext, when: number, accent: boolean): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const dur = 0.05;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(accent ? 1_600 : 1_200, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.18 : 0.1, when + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    oscillator.connect(gain);
    this.track(oscillator, gain);
    gain.connect(this.output ?? context.destination);
    oscillator.start(when);
    oscillator.stop(when + dur + 0.02);
  }
}
