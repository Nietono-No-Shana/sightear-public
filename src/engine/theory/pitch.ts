import type { Cents, Midi, Pitch, PitchClass } from '../ports';

export const A4_MIDI: Midi = 69;
export const A4_HZ = 440;
export const MIDI_MIN = 0;
export const MIDI_MAX = 127;

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/**
 * 带拼写的音高。ports 的 Pitch 只有 midi + name，而音程性质取决于字母与变音记号
 * （C–F# 是增四度，C–Gb 是减五度），所以拼写必须在 theory 内部显式保留。
 */
export interface SpelledPitch {
  readonly letter: Letter;
  readonly accidental: number;
  readonly octave: number;
  readonly midi: Midi;
  readonly name: string;
}

export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export const NATURAL_SEMITONES: Readonly<Record<Letter, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

const FLAT_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError(`index ${index} is out of range`);
  }
  return item;
}

function accidentalSuffix(accidental: number): string {
  if (accidental === 0) return '';
  return (accidental > 0 ? '#' : 'b').repeat(Math.abs(accidental));
}

export function isMidi(value: number): boolean {
  return Number.isInteger(value) && value >= MIDI_MIN && value <= MIDI_MAX;
}

export function assertMidi(value: number): void {
  if (!isMidi(value)) {
    throw new RangeError(`MIDI must be an integer in [${MIDI_MIN}, ${MIDI_MAX}], got ${value}`);
  }
}

export function midiToPitchClass(midi: Midi): PitchClass {
  return ((midi % 12) + 12) % 12;
}

export function midiToOctave(midi: Midi): number {
  return Math.floor(midi / 12) - 1;
}

export function midiToFrequency(midi: Midi, a4Hz: number = A4_HZ): number {
  return a4Hz * 2 ** ((midi - A4_MIDI) / 12);
}

export function frequencyToMidi(hz: number, a4Hz: number = A4_HZ): number {
  if (!Number.isFinite(hz) || hz <= 0) {
    throw new RangeError(`frequency must be a positive finite number, got ${hz}`);
  }
  return A4_MIDI + 12 * Math.log2(hz / a4Hz);
}

export function centsBetween(hz: number, referenceHz: number): Cents {
  if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(referenceHz) || referenceHz <= 0) {
    throw new RangeError('both frequencies must be positive finite numbers');
  }
  return 1200 * Math.log2(hz / referenceHz);
}

export function centsFromEqualTemperament(
  hz: number,
  midi: Midi,
  a4Hz: number = A4_HZ,
): Cents {
  return centsBetween(hz, midiToFrequency(midi, a4Hz));
}

export function midiToName(midi: Midi, preferFlats = false): string {
  assertMidi(midi);
  const table = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  return `${at(table, midiToPitchClass(midi))}${midiToOctave(midi)}`;
}

export function pitchClassName(pc: PitchClass, preferFlats = false): string {
  if (!Number.isInteger(pc) || pc < 0 || pc > 11) {
    throw new RangeError(`pitch class must be an integer in [0, 11], got ${pc}`);
  }
  return at(preferFlats ? FLAT_NAMES : SHARP_NAMES, pc);
}

export function midiToPitch(midi: Midi, preferFlats = false): Pitch {
  return { midi, name: midiToName(midi, preferFlats) };
}

/** 只接受 0..6。越界说明调用方索引算错，取模会把它掩盖成合法音名。 */
export function letterAt(index: number): Letter {
  return at(LETTERS, index);
}

export function makeSpelled(letter: Letter, accidental: number, octave: number): SpelledPitch {
  if (!Number.isInteger(accidental) || accidental < -2 || accidental > 2) {
    throw new RangeError(`accidental must be an integer in [-2, 2], got ${accidental}`);
  }
  if (!Number.isInteger(octave) || octave < -1 || octave > 9) {
    throw new RangeError(`octave must be an integer in [-1, 9], got ${octave}`);
  }
  const midi = (octave + 1) * 12 + NATURAL_SEMITONES[letter] + accidental;
  assertMidi(midi);
  return { letter, accidental, octave, midi, name: `${letter}${accidentalSuffix(accidental)}${octave}` };
}

export function parsePitchName(name: string): SpelledPitch | null {
  const normalized = name.trim().replaceAll('♯', '#').replaceAll('♭', 'b');
  const match = /^([A-Ga-g])(##|bb|#|b)?(-?\d+)$/.exec(normalized);
  if (match === null) return null;

  const letter = at(match, 1).toUpperCase() as Letter;
  const suffix = match[2] ?? '';
  const octave = Number(at(match, 3));
  if (!Number.isInteger(octave)) return null;

  const accidental = suffix === '##' ? 2 : suffix === '#' ? 1 : suffix === 'bb' ? -2 : suffix === 'b' ? -1 : 0;
  try {
    return makeSpelled(letter, accidental, octave);
  } catch {
    return null;
  }
}

export function toPitch(pitch: SpelledPitch): Pitch {
  return { midi: pitch.midi, name: pitch.name };
}
