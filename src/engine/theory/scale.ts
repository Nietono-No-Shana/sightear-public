import type { Pitch, PitchClass, ScaleMode } from '../ports';
import type { ChordQuality } from './chord';
import { transposeBy } from './interval';
import { midiToPitch, midiToPitchClass, toPitch, type SpelledPitch } from './pitch';

export type { ScaleMode } from '../ports';

/**
 * Semitone offsets from the tonic, in scale order. Seven-note modes are the
 * only ones usable for diatonic harmony; the shorter and octatonic scales are
 * identification material only.
 */
export const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorianFlat2: [0, 1, 3, 5, 7, 9, 10],
  lydianAugmented: [0, 2, 4, 6, 8, 9, 11],
  lydianDominant: [0, 2, 4, 6, 7, 9, 10],
  mixolydianFlat6: [0, 2, 4, 5, 7, 8, 10],
  locrianSharp2: [0, 2, 3, 5, 6, 8, 10],
  altered: [0, 1, 3, 4, 6, 8, 10],
  locrianSharp6: [0, 1, 3, 5, 6, 9, 10],
  ionianSharp5: [0, 2, 4, 5, 8, 9, 11],
  dorianSharp4: [0, 2, 3, 6, 7, 9, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  lydianSharp2: [0, 3, 4, 6, 7, 9, 11],
  ultralocrian: [0, 1, 3, 4, 6, 8, 9],
  wholeTone: [0, 2, 4, 6, 8, 10],
  diminishedWholeHalf: [0, 2, 3, 5, 6, 8, 9, 11],
  diminishedHalfWhole: [0, 1, 3, 4, 6, 7, 9, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
} as const satisfies Record<ScaleMode, readonly number[]>;

export const SCALE_LABELS: Readonly<Record<ScaleMode, string>> = {
  major: '大调',
  dorian: '多利亚调式',
  phrygian: '弗里几亚调式',
  lydian: '利底亚调式',
  mixolydian: '混合利底亚调式',
  naturalMinor: '自然小调',
  locrian: '洛克里亚调式',
  harmonicMinor: '和声小调',
  melodicMinor: '旋律小调',
  dorianFlat2: '多利亚降二调式',
  lydianAugmented: '利底亚增五调式',
  lydianDominant: '利底亚属七调式',
  mixolydianFlat6: '混合利底亚降六调式',
  locrianSharp2: '洛克里亚升二调式',
  altered: '变化音阶',
  locrianSharp6: '洛克里亚升六调式',
  ionianSharp5: '伊奥尼亚增五调式',
  dorianSharp4: '多利亚升四调式',
  phrygianDominant: '弗里几亚属七调式',
  lydianSharp2: '利底亚升二调式',
  ultralocrian: '超洛克里亚调式',
  wholeTone: '全音阶',
  diminishedWholeHalf: '减音阶（全半）',
  diminishedHalfWhole: '减音阶（半全）',
  pentatonicMajor: '大调五声音阶',
  pentatonicMinor: '小调五声音阶',
};

export interface DiatonicChord {
  readonly root: SpelledPitch;
  readonly quality: ChordQuality;
  readonly tones: readonly SpelledPitch[];
}

const SEVEN_DEGREE_MODES = 7;
const SCALE_DEGREES = [1, 2, 3, 4, 5, 6, 7] as const;

function assertSevenNote(mode: ScaleMode): void {
  if (SCALE_INTERVALS[mode].length !== SEVEN_DEGREE_MODES) {
    throw new RangeError(`${mode} is not a seven-note mode`);
  }
}

/**
 * 取第 N 级。N 可以超过 7（第 8 级就是高八度），音级始终按自然音字母递增，
 * 所以和声小调的升七级会得到 G#，不会写成 Ab。仅七声音阶支持拼写级数。
 */
export function scaleDegree(
  tonic: SpelledPitch,
  mode: ScaleMode,
  degree: number,
): SpelledPitch {
  if (!Number.isInteger(degree) || degree < 1) {
    throw new RangeError(`scale degree must be a positive integer, got ${degree}`);
  }
  assertSevenNote(mode);
  const intervals = SCALE_INTERVALS[mode];
  const octaves = Math.floor((degree - 1) / SEVEN_DEGREE_MODES);
  const index = (degree - 1) % SEVEN_DEGREE_MODES;
  const semitones = intervals[index]! + octaves * 12;
  try {
    return transposeBy(tonic, degree, semitones);
  } catch {
    throw new RangeError(`cannot spell degree ${degree} of ${mode} on ${tonic.name}`);
  }
}

/** 返回七个音级，不含高八度重复。升号/降号由 letter 决定，所以 F# 大调会得到 E#。 */
export function buildScale(tonic: SpelledPitch, mode: ScaleMode): readonly SpelledPitch[] {
  assertSevenNote(mode);
  return SCALE_DEGREES.map((degree) => scaleDegree(tonic, mode, degree));
}

/**
 * 音阶辨认使用的完整上行材料：所有音级加高八度。
 * 七声音阶保留拼写；五声、六声、八声音阶只用 MIDI 名称。
 */
export function scaleNotes(tonic: SpelledPitch, mode: ScaleMode): readonly Pitch[] {
  const intervals = SCALE_INTERVALS[mode];
  if (intervals.length === SEVEN_DEGREE_MODES) {
    return [...buildScale(tonic, mode).map(toPitch), toPitch(scaleDegree(tonic, mode, 8))];
  }
  return [...intervals, 12].map((offset) => midiToPitch(tonic.midi + offset));
}

/** 按拼写判断，因此 B# 不算 C 大调的音，尽管两者 MIDI 相同。 */
export function isInScale(pitch: SpelledPitch, tonic: SpelledPitch, mode: ScaleMode): boolean {
  return buildScale(tonic, mode).some(
    (tone) => tone.letter === pitch.letter && tone.accidental === pitch.accidental,
  );
}

/** 按等音判断调内音，供听辨使用；拼写问题交给 isInScale。 */
export function scalePitchClasses(tonic: SpelledPitch, mode: ScaleMode): readonly PitchClass[] {
  return buildScale(tonic, mode).map((tone) => midiToPitchClass(tone.midi));
}

export function scaleToPitches(tones: readonly SpelledPitch[]): readonly Pitch[] {
  return tones.map(toPitch);
}

function toneAt(tones: readonly SpelledPitch[], index: number): SpelledPitch {
  const tone = tones[index];
  if (tone === undefined) {
    throw new RangeError(`missing chord tone ${index}`);
  }
  return tone;
}

function triadQuality(third: number, fifth: number): ChordQuality | null {
  if (third === 4 && fifth === 7) return 'major';
  if (third === 3 && fifth === 7) return 'minor';
  if (third === 3 && fifth === 6) return 'diminished';
  if (third === 4 && fifth === 8) return 'augmented';
  return null;
}

function seventhQuality(third: number, fifth: number, seventh: number): ChordQuality | null {
  if (third === 4 && fifth === 7 && seventh === 11) return 'major7';
  if (third === 4 && fifth === 7 && seventh === 10) return 'dominant7';
  if (third === 3 && fifth === 7 && seventh === 10) return 'minor7';
  if (third === 3 && fifth === 6 && seventh === 10) return 'halfDiminished7';
  if (third === 3 && fifth === 6 && seventh === 9) return 'diminished7';
  if (third === 3 && fifth === 6 && seventh === 11) return 'diminishedMajor7';
  return null;
}

/**
 * 调内和弦：从调式第 degree 级往上叠三度。返回 null 表示当前和弦模型
 * 表达不了这个性质（例如和声小调的 i7 是 minor-major7）。
 */
export function diatonicChord(
  tonic: SpelledPitch,
  mode: ScaleMode,
  degree: number,
  size: 3 | 4 = 3,
): DiatonicChord | null {
  if (size !== 3 && size !== 4) {
    throw new RangeError(`diatonic chord size must be 3 or 4, got ${size}`);
  }

  const root = scaleDegree(tonic, mode, degree);
  const offsets = size === 3 ? [0, 2, 4] : [0, 2, 4, 6];
  const tones = offsets.map((offset) => scaleDegree(tonic, mode, degree + offset));

  const third = toneAt(tones, 1).midi - root.midi;
  const fifth = toneAt(tones, 2).midi - root.midi;
  const quality =
    size === 3
      ? triadQuality(third, fifth)
      : seventhQuality(third, fifth, toneAt(tones, 3).midi - root.midi);

  if (quality === null) return null;
  return { root, quality, tones };
}
