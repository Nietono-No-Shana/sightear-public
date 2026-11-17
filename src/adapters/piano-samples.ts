/**
 * Salamander Grand Piano V3（Yamaha C5）的轻量采样集。
 *
 * 取自 Tone.js 发布的 mp3 子集：从 A0 起按小三度取样到 C8，共 30 个。
 * 为减小解码后的内存占用，本地文件已裁到 8 s、转单声道、并重新编码；
 * gain 是按起音 250 ms 的 RMS 预先算好的响度补偿，写死在表里。
 * 许可与改动说明见 public/audio/piano/LICENSE.txt。
 */

export interface PianoSample {
  readonly midi: number;
  readonly file: string;
  /** 播放前乘到增益上的响度补偿 */
  readonly gain: number;
}

export const PIANO_SAMPLES: readonly PianoSample[] = [
  { midi: 21, file: 'A0.mp3', gain: 0.76 },
  { midi: 24, file: 'C1.mp3', gain: 0.8 },
  { midi: 27, file: 'Ds1.mp3', gain: 0.75 },
  { midi: 30, file: 'Fs1.mp3', gain: 0.71 },
  { midi: 33, file: 'A1.mp3', gain: 0.89 },
  { midi: 36, file: 'C2.mp3', gain: 0.88 },
  { midi: 39, file: 'Ds2.mp3', gain: 0.75 },
  { midi: 42, file: 'Fs2.mp3', gain: 0.74 },
  { midi: 45, file: 'A2.mp3', gain: 0.92 },
  { midi: 48, file: 'C3.mp3', gain: 0.72 },
  { midi: 51, file: 'Ds3.mp3', gain: 0.73 },
  { midi: 54, file: 'Fs3.mp3', gain: 1.39 },
  { midi: 57, file: 'A3.mp3', gain: 1.82 },
  { midi: 60, file: 'C4.mp3', gain: 0.75 },
  { midi: 63, file: 'Ds4.mp3', gain: 0.93 },
  { midi: 66, file: 'Fs4.mp3', gain: 0.93 },
  { midi: 69, file: 'A4.mp3', gain: 1.15 },
  { midi: 72, file: 'C5.mp3', gain: 2.13 },
  { midi: 75, file: 'Ds5.mp3', gain: 1.63 },
  { midi: 78, file: 'Fs5.mp3', gain: 1.07 },
  { midi: 81, file: 'A5.mp3', gain: 1.57 },
  { midi: 84, file: 'C6.mp3', gain: 2.11 },
  { midi: 87, file: 'Ds6.mp3', gain: 1.44 },
  { midi: 90, file: 'Fs6.mp3', gain: 2.14 },
  { midi: 93, file: 'A6.mp3', gain: 2.2 },
  { midi: 96, file: 'C7.mp3', gain: 2.2 },
  { midi: 99, file: 'Ds7.mp3', gain: 2.2 },
  { midi: 102, file: 'Fs7.mp3', gain: 2.2 },
  { midi: 105, file: 'A7.mp3', gain: 2.2 },
  { midi: 108, file: 'C8.mp3', gain: 2.2 },
];

export interface PianoVoice {
  readonly sample: PianoSample;
  readonly playbackRate: number;
}

const MIDI_MIN = 0;
const MIDI_MAX = 127;

/** 取最近的采样，音高差用 playbackRate 补偿；超出采样范围时钳到端点。 */
export function pianoVoiceFor(midi: number): PianoVoice {
  const target = Math.max(MIDI_MIN, Math.min(MIDI_MAX, Math.round(midi)));
  let best = PIANO_SAMPLES[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const sample of PIANO_SAMPLES) {
    const distance = Math.abs(sample.midi - target);
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }

  return { sample: best, playbackRate: 2 ** ((target - best.midi) / 12) };
}
