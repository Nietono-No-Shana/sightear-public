import { LETTERS, letterAt, makeSpelled, NATURAL_SEMITONES, type SpelledPitch } from './pitch';

export type IntervalQuality = 'P' | 'M' | 'm' | 'A' | 'd';

export interface Interval {
  /** 自然音级数，1 = 同度，8 = 八度，9 = 九度（复音程） */
  readonly number: number;
  readonly semitones: number;
  readonly quality: IntervalQuality;
  /** 缩写，如 P5 / m3 / A4 */
  readonly label: string;
}

interface BaseInterval {
  readonly perfect: boolean;
  readonly semitones: number;
}

function simpleBase(simpleNumber: number): BaseInterval | null {
  switch (simpleNumber) {
    case 1:
      return { perfect: true, semitones: 0 };
    case 2:
      return { perfect: false, semitones: 2 };
    case 3:
      return { perfect: false, semitones: 4 };
    case 4:
      return { perfect: true, semitones: 5 };
    case 5:
      return { perfect: true, semitones: 7 };
    case 6:
      return { perfect: false, semitones: 9 };
    case 7:
      return { perfect: false, semitones: 11 };
    default:
      return null;
  }
}

export function qualityOf(number: number, semitones: number): IntervalQuality | null {
  if (!Number.isInteger(number) || number < 1) return null;
  if (!Number.isInteger(semitones) || semitones < 0) return null;

  const simpleNumber = ((number - 1) % 7) + 1;
  const octaves = Math.floor((number - 1) / 7);
  const base = simpleBase(simpleNumber);
  if (base === null) return null;

  const delta = semitones - (base.semitones + octaves * 12);
  if (base.perfect) {
    if (delta === 0) return 'P';
    if (delta === -1) return 'd';
    if (delta === 1) return 'A';
    return null;
  }
  if (delta === 0) return 'M';
  if (delta === -1) return 'm';
  if (delta === -2) return 'd';
  if (delta === 1) return 'A';
  return null;
}

export function makeInterval(number: number, semitones: number): Interval {
  const quality = qualityOf(number, semitones);
  if (quality === null) {
    throw new RangeError(`cannot name interval: number=${number}, semitones=${semitones}`);
  }
  return { number, semitones, quality, label: `${quality}${number}` };
}

/**
 * 以低音为根计算音程。下行旋律由播放顺序表达，不改变音程本身：
 * 例如 C5 下到 F4 仍是 P5，只是方向为下行。
 */
export function intervalBetween(lower: SpelledPitch, upper: SpelledPitch): Interval {
  if (upper.midi < lower.midi) {
    throw new RangeError('intervalBetween expects lower.midi <= upper.midi');
  }
  const lowerIndex = lower.octave * 7 + LETTERS.indexOf(lower.letter);
  const upperIndex = upper.octave * 7 + LETTERS.indexOf(upper.letter);
  return makeInterval(upperIndex - lowerIndex + 1, upper.midi - lower.midi);
}

export function transposeBy(
  root: SpelledPitch,
  number: number,
  semitones: number,
): SpelledPitch {
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError(`interval number must be a positive integer, got ${number}`);
  }
  if (!Number.isInteger(semitones) || semitones < 0) {
    throw new RangeError(`interval semitones must be a non-negative integer, got ${semitones}`);
  }

  const steps = number - 1;
  const index = LETTERS.indexOf(root.letter) + steps;
  const letter = letterAt(index % 7);
  const octave = root.octave + Math.floor(index / 7);
  const naturalMidi = (octave + 1) * 12 + NATURAL_SEMITONES[letter];
  return makeSpelled(letter, root.midi + semitones - naturalMidi, octave);
}

export function invertInterval(interval: Interval): Interval {
  if (interval.number < 1 || interval.number > 8) {
    throw new RangeError(`only simple intervals (1..8) can be inverted, got ${interval.number}`);
  }
  return makeInterval(9 - interval.number, 12 - interval.semitones);
}
