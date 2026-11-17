import { EXERCISE_EXAMPLES } from '@engine/config';
import { generateExercise } from '@engine/items';
import type { AnswerKey, NoteEvent, Response, Score, ScoreNote } from '@engine/ports';
import { judge } from '@engine/scoring';
import { midiToPitch, scoreTimeline } from '@engine/theory';
import { makeRngFactory } from './support/rng';

const item = generateExercise(EXERCISE_EXAMPLES.find((spec) => spec.kind === 'melody-singing')!, 0, makeRngFactory());
const policy = { onsetMs: 80, durationMs: 100, pitchCents: 35, latencyMs: 0, alignStart: false };
const expected: readonly NoteEvent[] = [60, 62, 64].map((midi, index) => ({ midi, start: index * 1_000, dur: 800, cents: 0 }));
const key: Extract<AnswerKey, { type: 'performance' }> = {
  type: 'performance', mode: 'sung', notes: expected, tempoBpm: 60, end: 3_000,
  rhythmOnly: false, timing: 'full', policy,
};
function sung(notes: readonly NoteEvent[], answer = key) {
  return judge(item.presented, answer, { kind: 'sung', notes: notes.map((note) => ({ ...note })), rtMs: 10 });
}
function note(midi: number | null, value: 1 | 2 | 4 | 8 = 4, tie = false): ScoreNote {
  return { pitch: midi === null ? null : midiToPitch(midi), duration: { value, dots: 0 }, tie };
}
function score(notes: ScoreNote[]): Score {
  return { clef: 'treble', measures: [{ key: { tonic: 0, mode: 'major', fifths: 0 }, time: { beats: 4, unit: 4 }, voices: [{ notes }] }] };
}

describe('performance scoring boundaries', () => {
  it.each([[-80, true], [80, true], [-80.01, false], [80.01, false]])('applies onset tolerance at %i ms', (offset, accepted) => {
    const result = sung(expected.map((event, index) => ({ ...event, start: event.start + (index === 1 ? offset : 0) })));
    expect(result.correct).toBe(accepted);
    expect(result.pitchScore).toBe(1);
    if (!accepted) expect(result.details?.[1]?.errors).toContain('rhythm');
  });
  it.each([[-35, true], [35, true], [-35.01, false], [35.01, false]])('applies pitch tolerance at %i cents', (cents, accepted) => {
    const result = sung(expected.map((event, index) => ({ ...event, cents: index === 1 ? cents : 0 })));
    expect(result.correct).toBe(accepted);
    expect(result.rhythmScore).toBe(1);
  });
  it.each([[-100, true], [100, true], [-100.01, false], [100.01, false]])('applies duration tolerance at %i ms', (duration, accepted) => {
    expect(sung(expected.map((event, index) => ({ ...event, dur: event.dur + (index === 1 ? duration : 0) }))).correct).toBe(accepted);
  });
  it('locates omissions, extras and octave errors without shifting subsequent matches', () => {
    const missing = sung([expected[0]!, expected[2]!]);
    expect(missing.details?.find((detail) => detail.errors.includes('omission'))).toMatchObject({ expectedIndex: 1, responseIndex: null });
    expect(missing.details?.at(-1)).toMatchObject({ expectedIndex: 2, responseIndex: 1, errors: [] });
    const extra = sung([expected[0]!, { midi: 70, start: 500, dur: 200, cents: 0 }, ...expected.slice(1)]);
    expect(extra.details?.find((detail) => detail.errors.includes('extra'))).toMatchObject({ expectedIndex: null, responseIndex: 1 });
    expect(extra.partial).toBeLessThan(1);
    const octave = sung(expected.map((event, index) => ({ ...event, midi: event.midi + (index === 1 ? 12 : 0) })));
    expect(octave.details?.[1]).toMatchObject({ errors: ['pitch'], cents: 1200 });
  });
  it('separates latency calibration, permitted start alignment and tempo drift', () => {
    const late = expected.map((event) => ({ ...event, start: event.start + 200 }));
    expect(sung(late).correct).toBe(false);
    expect(sung(late, { ...key, policy: { ...policy, latencyMs: 200 } }).correct).toBe(true);
    expect(sung(late, { ...key, policy: { ...policy, alignStart: true } }).correct).toBe(true);
    expect(sung(expected.map((event) => ({ ...event, start: event.start * 1.2 + 200 })), { ...key, policy: { ...policy, alignStart: true } }).correct).toBe(false);
  });
  it('grades isolated interval singing on pitch without requiring a fixed note length', () => {
    const result = sung([{ ...expected[0]!, start: 2_000, dur: 4_000 }], { ...key, notes: [expected[0]!], timing: 'none' });
    expect(result).toMatchObject({ correct: true, partial: 1, pitchScore: 1 });
    expect(result).not.toHaveProperty('rhythmScore');
    const isolated = { ...key, notes: [expected[0]!], timing: 'none' as const };
    const attack = sung([{ midi: 59, cents: 0, start: 0, dur: 120 }, { ...expected[0]!, start: 120, dur: 880 }], isolated);
    expect(attack).toMatchObject({ correct: true, partial: 1 });
    const wrong = sung([{ midi: 70, cents: 0, start: 0, dur: 900 }, { ...expected[0]!, start: 900, dur: 100 }], isolated);
    expect(wrong.pitchScore).toBeLessThan(1);
  });
  it('grades taps by onsets and rejects unusable or malformed performance input', () => {
    const tapped = { ...key, mode: 'tapped' as const, rhythmOnly: true, timing: 'onset' as const };
    expect(judge(item.presented, tapped, { kind: 'tapped', onsets: [0, 1000, 2000], rtMs: 0 }).correct).toBe(true);
    expect(judge(item.presented, tapped, { kind: 'tapped', onsets: [0, 2000], rtMs: 0 }).errorType).toBe('omission');
    const bad: Response[] = [{ kind: 'tapped', onsets: [], rtMs: 0 }, { kind: 'tapped', onsets: [NaN], rtMs: 0 }, { kind: 'tapped', onsets: [1000, 0], rtMs: 0 }, { kind: 'sung', notes: [], rtMs: 0 }];
    for (const response of bad) expect(() => judge(item.presented, response.kind === 'sung' ? key : tapped, response)).toThrow();
    expect(() => sung([{ ...expected[0]!, dur: 0 }])).toThrow();
    expect(() => sung([{ ...expected[0]!, cents: Infinity }])).toThrow();
    expect(() => sung(Array.from({ length: 513 }, () => expected[0]!))).toThrow('too many');
  });
});

describe('notation semantic comparison', () => {
  const target = score([note(60, 2), note(62), note(64)]);
  const timeline = scoreTimeline(target, 60);
  const notation: Extract<AnswerKey, { type: 'performance' }> = { ...key, mode: 'notation', notes: timeline.notes, end: timeline.end, policy: { ...policy, onsetMs: 0, durationMs: 0, pitchCents: 0 } };
  const grade = (submitted: Score) => judge(item.presented, notation, { kind: 'notation', score: submitted, rtMs: 0 });
  it('accepts tied equivalents and enharmonic spelling but distinguishes repeated notes', () => {
    expect(grade(score([note(60, 4, true), note(60), note(62), note(64)])).correct).toBe(true);
    const enharmonic = score([note(60, 2), note(62), note(64)]);
    enharmonic.measures[0]!.voices[0]!.notes[0]!.pitch!.name = 'B#3';
    expect(grade(enharmonic).correct).toBe(true);
    expect(grade(score([note(60), note(60), note(62), note(64)])).correct).toBe(false);
  });
  it('counts incomplete notation as omissions but rejects overflowing notation', () => {
    expect(grade(score([note(60, 2)])).errorType).toBe('omission');
    expect(grade({ clef: 'treble', measures: [] })).toMatchObject({ correct: false, partial: 0 });
    expect(() => grade(score([note(60, 1), note(62)]))).toThrow('overflow');
    expect(grade({ ...target, measures: [...target.measures, ...score([note(null, 1)]).measures] }).correct).toBe(false);
  });
  it('ignores pitch only for rhythm dictation', () => {
    const submitted = score([note(72, 2), note(74), note(76)]);
    expect(grade(submitted).correct).toBe(false);
    expect(judge(item.presented, { ...notation, rhythmOnly: true }, { kind: 'notation', score: submitted, rtMs: 0 }).correct).toBe(true);
  });
});

describe('score timeline', () => {
  it('preserves rests, dotted notes, tuplets and cross-bar ties', () => {
    const triplet: ScoreNote = { ...note(62, 8), duration: { value: 8, dots: 0, tuplet: { actual: 3, normal: 2 } } };
    const source = score([{ ...note(null), duration: { value: 4, dots: 1 } }, note(60, 8), triplet, triplet, triplet, note(64)]);
    const before = JSON.stringify(source);
    const timeline = scoreTimeline(source, 60);
    [1500, 2000, 2000 + 1000 / 3, 2000 + 2000 / 3, 3000].forEach((start, index) => expect(timeline.notes[index]?.start).toBeCloseTo(start));
    expect(timeline.end).toBeCloseTo(4000);
    expect(JSON.stringify(source)).toBe(before);
    const tied = { ...source, measures: [...score([note(60, 1, true)]).measures, ...score([note(60, 1)]).measures] };
    expect(scoreTimeline(tied, 60).notes).toHaveLength(1);
    expect(scoreTimeline(tied, 60).notes[0]?.dur).toBeCloseTo(8000);
  });
  it('rejects broken ties, incomplete sources, inconsistent pitches and polyphony', () => {
    for (const source of [score([note(60, 1, true)]), score([note(60, 2, true), note(62, 2)]), score([note(null, 1, true)]), score([note(60)])]) expect(() => scoreTimeline(source, 60)).toThrow();
    const wrong = score([note(60, 1)]);
    wrong.measures[0]!.voices[0]!.notes[0]!.pitch!.name = 'D4';
    expect(() => scoreTimeline(wrong, 60)).toThrow('pitch');
    const polyphonic = score([note(60, 1)]);
    polyphonic.measures[0]!.voices.push({ notes: [note(64, 1)] });
    expect(() => scoreTimeline(polyphonic, 60)).toThrow('single voice');
  });
});
