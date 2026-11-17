import type { Pitch } from '../ports';
import { makeInterval, transposeBy, type Interval } from './interval';
import { makeSpelled, toPitch, type SpelledPitch } from './pitch';
import { EXTENDED_CHORDS } from './extended-chords';
export { EXTENDED_CHORDS } from './extended-chords';

export type TriadQuality = 'major' | 'minor' | 'diminished' | 'augmented';

export type SeventhQuality =
  | 'dominant7'
  | 'major7'
  | 'minor7'
  | 'halfDiminished7'
  | 'diminished7';

export type ExtendedQuality = 'minor9' | 'dominant9' | 'dominant7b9' | 'major79';

export type SuspendedQuality = 'suspended2' | 'suspended4' | 'dominant7sus4';

export type AlteredQuality =
  | 'majorFlat5'
  | 'majorSharp5'
  | 'dominant7Flat5'
  | 'dominant7Sharp5';

export type AddedQuality =
  | 'major6'
  | 'minor6'
  | 'majorAdd9'
  | 'minorAdd9'
  | 'major6Flat5'
  | 'major6Sharp5';

export type AlteredMajor7Quality = 'major7Flat5' | 'major7Sharp5';

export type SuspendedMajor7Quality = 'major7sus4';

export type ChordQuality =
  | keyof typeof EXTENDED_CHORDS
  | TriadQuality
  | SeventhQuality
  | ExtendedQuality
  | SuspendedQuality
  | AlteredQuality
  | AddedQuality
  | AlteredMajor7Quality
  | SuspendedMajor7Quality;

interface ChordToneSpec {
  readonly number: number;
  readonly semitones: number;
}

const STACKS: Readonly<Record<ChordQuality, readonly ChordToneSpec[]>> = {
  ...Object.fromEntries(Object.entries(EXTENDED_CHORDS).map(([quality, definition]) =>
    [quality, definition.tones.map(([number, semitones]) => ({ number, semitones }))])) as unknown as Record<keyof typeof EXTENDED_CHORDS, readonly ChordToneSpec[]>,
  major: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 7 },
  ],
  minor: [
    { number: 3, semitones: 3 },
    { number: 5, semitones: 7 },
  ],
  diminished: [
    { number: 3, semitones: 3 },
    { number: 5, semitones: 6 },
  ],
  augmented: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 8 },
  ],
  dominant7: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 7 },
    { number: 7, semitones: 10 },
  ],
  major7: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 7 },
    { number: 7, semitones: 11 },
  ],
  minor7: [
    { number: 3, semitones: 3 },
    { number: 5, semitones: 7 },
    { number: 7, semitones: 10 },
  ],
  halfDiminished7: [
    { number: 3, semitones: 3 },
    { number: 5, semitones: 6 },
    { number: 7, semitones: 10 },
  ],
  diminished7: [
    { number: 3, semitones: 3 },
    { number: 5, semitones: 6 },
    { number: 7, semitones: 9 },
  ],
  minor9: [
    { number: 3, semitones: 3 },
    { number: 5, semitones: 7 },
    { number: 7, semitones: 10 },
    { number: 9, semitones: 14 },
  ],
  dominant9: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 7 },
    { number: 7, semitones: 10 },
    { number: 9, semitones: 14 },
  ],
  dominant7b9: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 7 },
    { number: 7, semitones: 10 },
    { number: 9, semitones: 13 },
  ],
  major79: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 7 },
    { number: 7, semitones: 11 },
    { number: 9, semitones: 14 },
  ],
  suspended2: [
    { number: 2, semitones: 2 },
    { number: 5, semitones: 7 },
  ],
  suspended4: [
    { number: 4, semitones: 5 },
    { number: 5, semitones: 7 },
  ],
  dominant7sus4: [
    { number: 4, semitones: 5 },
    { number: 5, semitones: 7 },
    { number: 7, semitones: 10 },
  ],
  majorFlat5: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 6 },
  ],
  majorSharp5: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 8 },
  ],
  dominant7Flat5: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 6 },
    { number: 7, semitones: 10 },
  ],
  dominant7Sharp5: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 8 },
    { number: 7, semitones: 10 },
  ],
  major6: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 7 },
    { number: 6, semitones: 9 },
  ],
  minor6: [
    { number: 3, semitones: 3 },
    { number: 5, semitones: 7 },
    { number: 6, semitones: 9 },
  ],
  majorAdd9: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 7 },
    { number: 9, semitones: 14 },
  ],
  minorAdd9: [
    { number: 3, semitones: 3 },
    { number: 5, semitones: 7 },
    { number: 9, semitones: 14 },
  ],
  major6Flat5: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 6 },
    { number: 6, semitones: 9 },
  ],
  major6Sharp5: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 8 },
    { number: 6, semitones: 9 },
  ],
  major7Flat5: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 6 },
    { number: 7, semitones: 11 },
  ],
  major7Sharp5: [
    { number: 3, semitones: 4 },
    { number: 5, semitones: 8 },
    { number: 7, semitones: 11 },
  ],
  major7sus4: [
    { number: 4, semitones: 5 },
    { number: 5, semitones: 7 },
    { number: 7, semitones: 11 },
  ],
};

const LABELS: Readonly<Record<ChordQuality, string>> = {
  ...Object.fromEntries(Object.entries(EXTENDED_CHORDS).map(([quality, definition]) => [quality, definition.code])) as Record<keyof typeof EXTENDED_CHORDS, string>,
  major: 'maj',
  minor: 'min',
  diminished: 'dim',
  augmented: 'aug',
  dominant7: 'dom7',
  major7: 'maj7',
  minor7: 'min7',
  halfDiminished7: 'm7b5',
  diminished7: 'dim7',
  minor9: 'min9',
  dominant9: 'dom9',
  dominant7b9: '7b9',
  major79: 'maj79',
  suspended2: 'sus2',
  suspended4: 'sus4',
  dominant7sus4: '7sus4',
  majorFlat5: 'majb5',
  majorSharp5: 'maj#5',
  dominant7Flat5: '7b5',
  dominant7Sharp5: '7#5',
  major6: 'maj6',
  minor6: 'min6',
  majorAdd9: 'majadd9',
  minorAdd9: 'minadd9',
  major6Flat5: 'maj6b5',
  major6Sharp5: 'maj6#5',
  major7Flat5: 'maj7b5',
  major7Sharp5: 'maj7#5',
  major7sus4: 'maj7sus4',
};

function raiseOctave(pitch: SpelledPitch): SpelledPitch {
  return makeSpelled(pitch.letter, pitch.accidental, pitch.octave + 1);
}

/**
 * 闭列和弦。转位把低音依次升高八度，根音因此以高八度出现在上方；
 * 这是闭列转位的定义，不是把根音丢掉。需要根音留在原八度时，用更低的根音构造。
 */
export function buildChord(
  root: SpelledPitch,
  quality: ChordQuality,
  inversion = 0,
): readonly SpelledPitch[] {
  const stack = STACKS[quality];
  if (!Number.isInteger(inversion) || inversion < 0 || inversion > stack.length) {
    throw new RangeError(`inversion must be an integer in [0, ${stack.length}], got ${inversion}`);
  }

  const tones: SpelledPitch[] = [root];
  for (const spec of stack) {
    tones.push(transposeBy(root, spec.number, spec.semitones));
  }

  const inverted = tones.map((tone, index) => (index < inversion ? raiseOctave(tone) : tone));
  return inverted.sort((a, b) => a.midi - b.midi);
}

export function chordIntervals(quality: ChordQuality): readonly Interval[] {
  return STACKS[quality].map((spec) => makeInterval(spec.number, spec.semitones));
}

export const CHORD_DEFINITIONS = Object.entries(STACKS).map(([quality, tones]) => ({
  quality: quality as ChordQuality, code: LABELS[quality as ChordQuality],
  tones: [{ number: 1, semitones: 0 }, ...tones],
}));

export function chordLabel(quality: ChordQuality): string {
  return LABELS[quality];
}

export function chordToPitches(tones: readonly SpelledPitch[]): readonly Pitch[] {
  return tones.map(toPitch);
}

export function isClosedVoicing(tones: readonly SpelledPitch[]): boolean {
  if (tones.length === 0) {
    throw new RangeError('voicing needs at least one tone');
  }
  let lowest = Infinity;
  let highest = -Infinity;
  for (const tone of tones) {
    lowest = Math.min(lowest, tone.midi);
    highest = Math.max(highest, tone.midi);
  }
  return highest - lowest <= 12;
}
