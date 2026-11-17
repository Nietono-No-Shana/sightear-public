import { generateExercise, generateScore } from '@engine/items';
import { EXERCISE_EXAMPLES, validateExerciseSpec } from '@engine/config';
import type { ScoreGeneratorSpec } from '@engine/ports';
import { parsePitchName, scoreTimeline } from '@engine/theory';
import { makeRng, makeRngFactory } from './support/rng';

const rule: ScoreGeneratorSpec = {
  kind: 'rhythm-grid', version: 1, clef: 'treble', key: { tonic: 0, mode: 'major', fifths: 0 },
  time: { beats: 4, unit: 4 }, measures: 4,
  durations: [{ value: 2, dots: 0 }, { value: 4, dots: 0 }, { value: 8, dots: 0 }], restProbability: 10,
};

describe('score generation boundaries', () => {
  it.each([{ beats: 3, unit: 4 }, { beats: 6, unit: 8 }, { beats: 5, unit: 8 }] as const)('fills $beats/$unit with reproducible material', (time) => {
    for (let seed = 0; seed < 64; seed += 1) {
      const spec = { ...rule, time };
      const score = generateScore(spec, makeRng(seed));
      expect(generateScore(spec, makeRng(seed))).toEqual(score);
      expect(scoreTimeline(score, 90).end).toBeCloseTo(time.beats * 4 / time.unit * 4 * 60_000 / 90);
    }
  });

  it.each([
    { tonic: 6, mode: 'major', fifths: 6, expected: 'E#4', midi: 65 },
    { tonic: 11, mode: 'major', fifths: -7, expected: 'Cb4', midi: 59 },
    { tonic: 1, mode: 'major', fifths: 7, expected: 'B#3', midi: 60 },
    { tonic: 3, mode: 'minor', fifths: -6, expected: 'Cb4', midi: 59 },
  ] as const)('preserves key spelling including octave boundaries: $expected', ({ tonic, mode, fifths, expected, midi }) => {
    const spec: ScoreGeneratorSpec = { ...rule, kind: 'diatonic-melody', key: { tonic, mode, fifths },
      pitchRange: [midi, midi], maxLeapSemitones: 5, restProbability: 0 };
    const score = generateScore(spec, makeRng(42));
    const pitches = score.measures.flatMap((measure) => measure.voices[0]!.notes.map((note) => note.pitch!));
    expect(pitches.every((pitch) => pitch.name === expected && parsePitchName(pitch.name)?.midi === pitch.midi)).toBe(true);
    expect(() => scoreTimeline(score, 90)).not.toThrow();
  });

  it('rejects unknown rules, invalid versions and unfillable meters before generation', () => {
    expect(() => generateScore({ ...rule, version: 4 } as unknown as ScoreGeneratorSpec, makeRng(0))).toThrow();
    expect(() => generateScore({ ...rule, arbitrary: true } as ScoreGeneratorSpec, makeRng(0))).toThrow(/unsupported/);
    expect(() => generateScore({ ...rule, durations: [] }, makeRng(0))).toThrow();
    expect(() => generateScore({ ...rule, time: { beats: 3, unit: 8 }, durations: [{ value: 4, dots: 0 }] }, makeRng(0))).toThrow();
    expect(() => generateScore({ ...rule, measures: 64 }, makeRng(0))).toThrow(/bounded/);
  });

  it('supports all seven score exercise presentations with deterministic templates', () => {
    for (const base of EXERCISE_EXAMPLES) {
      if (!('scores' in base)) continue;
      const generator: ScoreGeneratorSpec = base.kind.startsWith('rhythm-') ? rule
        : { ...rule, kind: 'diatonic-melody', pitchRange: [60, 72], maxLeapSemitones: 5 };
      const spec = { ...base, scores: [], generator };
      const item = generateExercise(spec, 42, makeRngFactory());
      expect(generateExercise(spec, 42, makeRngFactory())).toEqual(item);
      expect(generateExercise(spec, 43, makeRngFactory()).templateKey).toBe(item.templateKey);
      expect(generateExercise({ ...spec, generator: { ...generator, restProbability: 0 } }, 42, makeRngFactory()).templateKey).not.toBe(item.templateKey);
      if (base.kind === 'rhythm-correction') expect(item.key.type).toBe('locations');
      else expect(item.answerScore).toBeDefined();
    }
  });

  it('rejects impossible correction rules and bounds unlucky retries', () => {
    expect(() => generateScore({ ...rule, measures: 1, durations: [{ value: 1, dots: 0 }] }, makeRng(0), 120)).toThrow(/target/);
    const hostile = { next: () => 0, int: () => 0, fork: () => hostile };
    expect(() => generateScore({ ...rule, measures: 1, durations: [{ value: 1, dots: 0 }, { value: 4, dots: 0 }] }, hostile, 120)).toThrow(/could not produce/);
  });

  it('rejects fast capture and unknown nested duration fields', () => {
    const base = EXERCISE_EXAMPLES.find((entry) => entry.kind === 'rhythm-reading')!;
    expect(() => validateExerciseSpec({ ...base, kind: 'rhythm-reading', scores: [], tempoBpm: 200,
      generator: { ...rule, durations: [{ value: 16, dots: 0 }] } })).toThrow(/90ms/);
    expect(() => generateScore({ ...rule, durations: [{ value: 4, dots: 0, arbitrary: true }] } as unknown as ScoreGeneratorSpec, makeRng(0))).toThrow(/unsupported/);
  });
});
