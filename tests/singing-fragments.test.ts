import { judge } from '@engine/scoring';
import { generateExercise } from '@engine/items';
import { EXERCISE_EXAMPLES } from '@engine/config';
import type { AnswerKey, NoteEvent } from '@engine/ports';
import { makeRngFactory } from './support/rng';

const source = EXERCISE_EXAMPLES.find((spec) => spec.kind === 'melody-singing')!;
const item = generateExercise(source, 0, makeRngFactory());
const note = (start: number, dur: number, cents = 0, midi = 57): NoteEvent => ({ start, dur, cents, midi });
const key: Extract<AnswerKey, { type: 'performance' }> = {
  type: 'performance', mode: 'sung', notes: [note(0, 1000)], end: 1000, tempoBpm: 60,
  rhythmOnly: false, timing: 'full', policy: { ...source.policy, grading: 'graded-v2' },
};
const grade = (notes: NoteEvent[], target = key) => judge(item.presented, target, { kind: 'sung', notes, rtMs: 0 });

it('scores a briefly interrupted A3 as one note without losing half the pitch or rhythm score', () => {
  const notes = [note(0, 400, 4), note(480, 520, 21)];
  const before = JSON.stringify(notes);
  const result = grade(notes);
  expect(result).toMatchObject({ correct: true, partial: 1, pitchScore: 1, rhythmScore: 1 });
  expect(result.details).toHaveLength(1);
  expect(result.details![0]).toMatchObject({ responseIndex: 0, responseIndices: [0, 1], cents: 21 });
  expect(grade(notes, { ...key, timing: 'none' }).partial).toBe(1);
  expect(JSON.stringify(notes)).toBe(before);
});

it('absorbs a short attack into the stable note without shifting its onset', () => {
  expect(grade([note(0, 100, 0, 56), note(100, 900, 4)])).toMatchObject({ correct: true, partial: 1 });
  expect(grade([note(0, 120, 0, 56), note(160, 840, 4)]).partial).toBe(1);
  expect(grade([note(0, 121, 0, 56), note(121, 879, 4)]).partial).toBe(1);
  expect(grade([note(0, 100, 0, 56), note(141, 859, 4)]).partial).toBe(1);
  expect(grade([note(0, 140, 0, 56), note(181, 819, 4)]).partial).toBe(1);
  expect(grade([note(0, 200, 0, 56), note(200, 800, 4)]).partial).toBe(1);
});

it('does not excuse a substantial wrong note, a late start or opposite pitch deviations', () => {
  expect(grade([note(0, 300, 0, 56), note(300, 700)]).partial).toBeLessThan(1);
  expect(grade([note(300, 100, 0, 56), note(400, 600)]).partial).toBeLessThan(1);
  expect(grade([note(0, 400, -40), note(480, 520, 40)]).pitchScore).toBeLessThan(1);
  expect(grade([note(0, 400, 40), note(480, 520, 45)]).pitchScore).toBeLessThan(1);
});

it('bounds gap repair and preserves separate repeated notes and rests', () => {
  expect(grade([note(0, 400), note(520, 480)]).partial).toBe(1);
  expect(grade([note(0, 400), note(521, 479)]).details).toHaveLength(2);
  expect(grade([note(0, 200), note(280, 200), note(560, 440)]).details).toHaveLength(2);
  const repeated = { ...key, notes: [note(0, 500), note(500, 500)] };
  expect(grade([note(0, 500), note(500, 500)], repeated).details).toHaveLength(2);
  expect(grade([note(0, 1000)], repeated)).toMatchObject({ correct: true, partial: 1 });
  expect(grade([note(0, 1000)], repeated).details).toHaveLength(2);
  const three = { ...key, notes: [note(0, 333), note(333, 333), note(666, 334)] };
  expect(grade([note(0, 1000)], three)).toMatchObject({ correct: true, partial: 1 });
  expect(grade([note(0, 1000)], three).details).toHaveLength(3);
  const gapped = { ...key, notes: [note(0, 400), note(600, 400)] };
  expect(grade([note(0, 1000)], gapped).partial).toBeLessThan(1);
  expect(grade([note(0, 450), note(550, 450)], { ...key, notes: [note(0, 450), note(550, 450)] }).details).toHaveLength(2);
  const shortThenLong = [note(0, 100, 0, 56), note(100, 900)];
  const result = grade(shortThenLong, { ...key, notes: shortThenLong });
  expect(result.partial).toBe(1);
  expect(result.details).toHaveLength(2);
});

it('preserves original response indices after grouping and leaves earlier policies unchanged', () => {
  const target = { ...key, notes: [note(0, 1000), note(1200, 500, 0, 60)], end: 1700 };
  const result = grade([note(0, 400), note(480, 520), note(1200, 500, 0, 60)], target);
  expect(result.details![1]).toMatchObject({ expectedIndex: 1, responseIndex: 2 });
  expect(grade([note(0, 400), note(480, 520)], { ...key, policy: { ...key.policy, grading: 'graded-v1' } }).details).toHaveLength(2);
});
