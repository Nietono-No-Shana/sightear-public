import { PIANO_SAMPLES, pianoVoiceFor } from './piano-samples';

const SAMPLE_BASE_URL = `${import.meta.env.BASE_URL}audio/piano/`;
/** 松键后的短淡出，避免硬切产生爆音 */
const RELEASE_SEC = 0.12;
const NOTE_GAIN = 0.95;
const DECODE_CONCURRENCY = 4;

type SampleMap = ReadonlyMap<number, AudioBuffer>;

/** 解码后的采样与 AudioContext 的采样率绑定，跨实例复用同一份。 */
let cache: Promise<SampleMap> | null = null;

async function fetchSample(context: AudioContext, file: string): Promise<AudioBuffer> {
  const response = await fetch(`${SAMPLE_BASE_URL}${file}`);
  if (!response.ok) {
    throw new Error(`piano sample ${file}: HTTP ${response.status}`);
  }
  return context.decodeAudioData(await response.arrayBuffer());
}

function decodeAll(context: AudioContext): Promise<SampleMap> {
  if (cache !== null) return cache;

  const pending = (async (): Promise<SampleMap> => {
    const buffers = new Map<number, AudioBuffer>();
    const queue = [...PIANO_SAMPLES];
    const worker = async (): Promise<void> => {
      for (let sample = queue.shift(); sample !== undefined; sample = queue.shift()) {
        buffers.set(sample.midi, await fetchSample(context, sample.file));
      }
    };
    await Promise.all(Array.from({ length: DECODE_CONCURRENCY }, worker));
    return buffers;
  })();

  cache = pending;
  pending.catch(() => {
    if (cache === pending) cache = null;
  });
  return pending;
}

function clampVelocity(velocity: number): number {
  return Math.max(0, Math.min(1, velocity));
}

/**
 * 采样钢琴声部。采样未就绪或加载失败时 `play` 返回 false，由调用方回退到振荡器，
 * 因此音频线程永远不会因为资源问题而卡住。
 */
export class PianoSampler {
  private samples: SampleMap | null = null;
  private loading: Promise<void> | null = null;
  private failed = false;
  private readonly voices = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly output: AudioNode,
  ) {}

  get ready(): boolean {
    return this.samples !== null;
  }

  /** 已失败过就不再让 schedule 触发重试，避免每题都发一次请求。 */
  get unavailable(): boolean {
    return this.failed;
  }

  prime(): Promise<void> {
    if (this.samples !== null) return Promise.resolve();
    if (this.loading !== null) return this.loading;

    this.failed = false;
    const loading = decodeAll(this.context)
      .then((samples) => {
        this.samples = samples;
      })
      .catch(() => {
        this.failed = true;
      })
      .finally(() => {
        if (this.loading === loading) this.loading = null;
      });

    this.loading = loading;
    return loading;
  }

  play(when: number, dur: number, midi: number, velocity: number): boolean {
    const samples = this.samples;
    if (samples === null) return false;

    const voice = pianoVoiceFor(midi);
    const buffer = samples.get(voice.sample.midi);
    if (buffer === undefined) return false;

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const peak = Math.max(0.0002, NOTE_GAIN * clampVelocity(velocity) ** 1.2 * voice.sample.gain);
    const end = when + Math.max(0.03, dur);

    source.buffer = buffer;
    source.playbackRate.value = voice.playbackRate;
    gain.gain.setValueAtTime(peak, when);
    gain.gain.setValueAtTime(peak, end);
    gain.gain.exponentialRampToValueAtTime(0.0001, end + RELEASE_SEC);

    source.connect(gain);
    gain.connect(this.output);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(when);
    source.stop(end + RELEASE_SEC + 0.02);
    return true;
  }

  stop(): void {
    for (const voice of this.voices) {
      try { voice.stop(); } catch {}
      voice.disconnect();
    }
    this.voices.clear();
  }
}
