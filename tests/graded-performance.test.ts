import { describe, expect, it } from 'vitest';
import { deviationCredit, judge } from '@engine/scoring';
import { scoreOf } from '@engine/ability';
import { EXERCISE_EXAMPLES } from '@engine/config';
import { generateExercise } from '@engine/items';
import type { AnswerKey, NoteEvent } from '@engine/ports';
import { makeRngFactory } from './support/rng';

const source = EXERCISE_EXAMPLES.find((spec) => spec.kind === 'melody-singing')!;
const item = generateExercise(source, 0, makeRngFactory());
const notes = [60, 62, 64].map((midi, index) => ({ midi, cents: 0, start: index * 1000, dur: 800 }));
const key: Extract<AnswerKey, { type: 'performance' }> = {
  type: 'performance', mode: 'sung', notes, end: 3000, tempoBpm: 60, rhythmOnly: false, timing: 'full', policy: source.policy,
};
const grade = (response: NoteEvent[], answer = key) => judge(item.presented, answer, { kind: 'sung', notes: response, rtMs: 0 });

describe('graded live performance', () => {
  it('preserves the previous grading version for older material', () => {
    expect(deviationCredit(75, 50, 'pitch')).toBe(0.8);
    expect(deviationCredit(450, 150, 'timing')).toBeCloseTo(0.2);
    const old = { ...key, policy: { ...key.policy, pitchCents: 50, onsetMs: 150, durationMs: 220, grading: 'graded-v1' as const } };
    expect(grade(notes.map((note) => ({ ...note, cents: 75 })), old).pitchScore).toBeCloseTo(0.8);
  });
  it.each([[0, 1], [25, 1], [40, 0.8], [60, 0.5], [75, 0.2], [100, 0], [1200, 0]])('awards graded pitch credit at ±%i cents', (error, credit) => {
    expect(deviationCredit(error, 25, 'pitch', 'graded-v2')).toBeCloseTo(credit);
    expect(deviationCredit(-error, 25, 'pitch', 'graded-v2')).toBeCloseTo(credit);
  });
  it('does not drop abruptly at a boundary and decreases monotonically', () => {
    let previous = 1;
    for (let cents = 0; cents <= 250; cents += 0.25) {
      const current = deviationCredit(cents, 25, 'pitch', 'graded-v2');
      expect(current).toBeLessThanOrEqual(previous);
      expect(current).toBeGreaterThanOrEqual(0);
      previous = current;
    }
    expect(deviationCredit(25.01, 25, 'pitch', 'graded-v2')).toBeGreaterThan(0.99);
  });
  it.each([[100, 1], [150, 0.8], [200, 0.5], [250, 0.2], [300, 0]])('grades ±%i ms onset deviations', (error, credit) => {
    expect(deviationCredit(error, 100, 'timing', 'graded-v2')).toBeCloseTo(credit);
    expect(deviationCredit(-error, 100, 'timing', 'graded-v2')).toBeCloseTo(credit);
  });
  it('supports zero timing tolerance without dividing by zero', () => {
    expect(deviationCredit(0, 0, 'timing')).toBe(1);
    expect(deviationCredit(1, 0, 'timing')).toBe(0);
  });
  it('gives a slightly sharp melody partial credit in every note and preserves replay scoring invariants', () => {
    const result = grade(notes.map((note) => ({ ...note, cents: 40, start: note.start + 150, dur: note.dur + 225 })));
    expect(result.correct).toBe(false);
    expect(result.pitchScore).toBeCloseTo(0.8);
    expect(result.rhythmScore).toBeCloseTo(0.8);
    expect(result.partial).toBeCloseTo(0.8);
    expect(result.details?.every((detail) => detail.pitchScore === 0.8 && detail.rhythmScore === 0.8)).toBe(true);
    expect(scoreOf(result)).toBeCloseTo(0.8);
    expect(grade(notes.map((note) => ({ ...note, cents: 25, start: note.start + 100, dur: note.dur + 150 })))).toMatchObject({ correct: true, partial: 1 });
  });
  it('retains later alignment after omissions and extras, and gives an octave error no pitch credit', () => {
    const omitted = grade([notes[0]!, notes[2]!]);
    expect(omitted.partial).toBeCloseTo(2 / 3);
    expect(omitted.details?.at(-1)).toMatchObject({ expectedIndex: 2, responseIndex: 1, errors: [] });
    const extra = grade([notes[0]!, { midi: 70, cents: 0, start: 500, dur: 200 }, ...notes.slice(1)]);
    expect(extra.partial).toBeCloseTo(0.75);
    expect(grade(notes.map((note) => ({ ...note, midi: note.midi - 12 }))).pitchScore).toBe(0);
  });
  it('ignores timing only for isolated pitch tasks and leaves notation exact', () => {
    expect(grade([{ ...notes[0]!, cents: 40, start: 1000, dur: 4000 }], { ...key, notes: [notes[0]!], timing: 'none' }).partial).toBeCloseTo(0.8);
    const notation = generateExercise(EXERCISE_EXAMPLES.find((spec) => spec.kind === 'melody-dictation')!, 0, makeRngFactory());
    if (notation.key.type !== 'performance') throw new Error('missing notation');
    expect(notation.key.policy).toMatchObject({ pitchCents: 0, onsetMs: 0, durationMs: 0 });
    expect(notation.key.policy.grading).toBeUndefined();
  });
});
