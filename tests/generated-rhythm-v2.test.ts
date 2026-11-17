import { generateScore, generateExercise } from '@engine/items';
import { EXERCISE_EXAMPLES } from '@engine/config';
import type { ScoreGeneratorSpec } from '@engine/ports';
import { durationTicks, scoreTimeline } from '@engine/theory';
import { makeRng, makeRngFactory } from './support/rng';

const rule: ScoreGeneratorSpec = {
  kind: 'rhythm-grid', version: 2, clef: 'treble', key: { tonic: 0, mode: 'major', fifths: 0 },
  time: { beats: 4, unit: 4 }, measures: 3, restProbability: 0,
  durations: [{ value: 8, dots: 1 }, { value: 16, dots: 0 }, { value: 8, dots: 0, tuplet: { actual: 3, normal: 2 } }],
};

describe('generated dotted rhythms, triplets and ties', () => {
  it('fills dotted and complete triplet groups deterministically without mutating rules', () => {
    const before = JSON.stringify(rule);
    let dotted = 0;
    let groups = 0;
    for (let seed = 0; seed < 100; seed += 1) {
      const score = generateScore(rule, makeRng(seed));
      expect(generateScore(rule, makeRng(seed))).toEqual(score);
      expect(scoreTimeline(score, 90).end).toBeCloseTo(8000);
      for (const measure of score.measures) {
        const notes = measure.voices[0]!.notes;
        expect(notes.reduce((total, note) => total + durationTicks(note.duration), 0)).toBe(1920);
        for (let index = 0; index < notes.length; index += 1) {
          const duration = notes[index]!.duration;
          if (duration.dots) dotted += 1;
          if (!duration.tuplet) continue;
          expect(notes.slice(index, index + 3).map((note) => note.duration)).toEqual([duration, duration, duration]);
          groups += 1;
          index += 2;
        }
      }
    }
    expect(dotted).toBeGreaterThan(0);
    expect(groups).toBeGreaterThan(0);
    expect(JSON.stringify(rule)).toBe(before);
  });

  it.each([{ beats: 3, unit: 4 }, { beats: 6, unit: 8 }, { beats: 5, unit: 8 }] as const)('supports dotted rhythms in $beats/$unit', (time) => {
    for (let seed = 0; seed < 20; seed += 1) {
      const score = generateScore({ ...rule, time }, makeRng(seed));
      expect(() => scoreTimeline(score, 90)).not.toThrow();
    }
  });

  it('fills double dots with complements and rejects partial triplet groups', () => {
    const double = { ...rule, durations: [{ value: 8 as const, dots: 2 as const }, { value: 16 as const, dots: 0 as const }] };
    expect(() => scoreTimeline(generateScore(double, makeRng(5)), 90)).not.toThrow();
    expect(() => generateScore({ ...rule, time: { beats: 1, unit: 8 }, durations: [rule.durations[2]!] }, makeRng(0))).toThrow(/complete/);
    const score = generateScore({ ...rule, durations: [rule.durations[2]!] }, makeRng(0));
    expect(score.measures[0]!.voices[0]!.notes).toHaveLength(12);
  });

  it.each([
    { withinMeasureProbability: 100, acrossMeasureProbability: 0, attacks: 3 },
    { withinMeasureProbability: 0, acrossMeasureProbability: 100, attacks: 10 },
    { withinMeasureProbability: 100, acrossMeasureProbability: 100, attacks: 1 },
    { withinMeasureProbability: 0, acrossMeasureProbability: 0, attacks: 12 },
  ])('ties only selected boundaries: $withinMeasureProbability / $acrossMeasureProbability', ({ attacks, ...ties }) => {
    const spec: ScoreGeneratorSpec = { ...rule, kind: 'diatonic-melody', durations: [{ value: 4, dots: 0 }],
      pitchRange: [60, 72], maxLeapSemitones: 2, ties };
    const score = generateScore(spec, makeRng(99));
    const timeline = scoreTimeline(score, 90);
    expect(timeline.notes).toHaveLength(attacks);
    expect(timeline.notes.reduce((sum, note) => sum + note.dur, 0)).toBeCloseTo(timeline.end);
    const notes = score.measures.flatMap((measure) => measure.voices[0]!.notes);
    expect(notes.at(-1)!.tie).toBe(false);
    for (let index = 0; index < notes.length - 1; index += 1) {
      if (notes[index]!.tie) expect(notes[index + 1]!.pitch).toEqual(notes[index]!.pitch);
    }
    expect(timeline.notes.slice(1).every((note, index) => Math.abs(note.midi - timeline.notes[index]!.midi) <= 2)).toBe(true);
  });

  it('never ties rests and merges tied rhythm events into single scored onsets', () => {
    const base = EXERCISE_EXAMPLES.find((spec) => spec.kind === 'rhythm-reading')!;
    for (let seed = 0; seed < 32; seed += 1) {
      const generator = { ...rule, restProbability: 60, ties: { withinMeasureProbability: 100, acrossMeasureProbability: 100 } };
      const item = generateExercise({ ...base, kind: 'rhythm-reading', scores: [], generator }, seed, makeRngFactory());
      const score = item.answerScore!;
      const notes = score.measures.flatMap((measure) => measure.voices[0]!.notes);
      if (item.key.type !== 'performance') throw new Error('missing performance key');
      expect(item.key.notes).toHaveLength(notes.filter((note, index) => note.pitch && !notes[index - 1]?.tie).length);
      expect(notes.every((note, index) => !note.tie || (note.pitch !== null && notes[index + 1]?.pitch !== null))).toBe(true);
      expect(() => scoreTimeline(score, 90)).not.toThrow();
    }
  });

  it('uses merged duration for correction eligibility and terminates if every note ties into one attack', () => {
    const ties = { withinMeasureProbability: 100, acrossMeasureProbability: 0 };
    expect(() => generateScore({ ...rule, durations: [{ value: 4, dots: 0 }], ties }, makeRng(0), 600)).not.toThrow();
    expect(() => generateScore({ ...rule, durations: [{ value: 4, dots: 0 }], ties: { ...ties, acrossMeasureProbability: 100 } }, makeRng(0), 600)).toThrow(/could not produce/);
  });

  it('rejects advanced v1 rules, unsupported tuplets and invalid probabilities', () => {
    expect(() => generateScore({ ...rule, version: 1 }, makeRng(0))).toThrow();
    expect(() => generateScore({ ...rule, durations: [{ value: 8, dots: 0, tuplet: { actual: 5, normal: 4 } }] }, makeRng(0))).toThrow(/3:2/);
    expect(() => generateScore({ ...rule, ties: { withinMeasureProbability: -1, acrossMeasureProbability: 0 } }, makeRng(0))).toThrow(/0..100/);
  });
});
