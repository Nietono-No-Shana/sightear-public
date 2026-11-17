import { EXERCISE_EXAMPLES, EXERCISE_SKILLS, SKILLS, exerciseSkillId, lessonForExercise, validateExerciseSpec } from '@engine/config';
import { generateExercise } from '@engine/items';
import type { Clock, ExerciseSpec, Response } from '@engine/ports';
import { readFileSync } from 'node:fs';
import { parseContentPack } from '@engine/config';
import { judge } from '@engine/scoring';
import { commit, createSession, nextItem } from '@engine/session';
import type { NextItem } from '@engine/selection';
import { replay as replayAbility } from '@engine/ability';
import { replay as replaySchedule } from '@engine/schedule';
import { midiToName, scoreTimeline } from '@engine/theory';
import { makeRng, makeRngFactory } from './support/rng';

const factory = makeRngFactory();
const generatedExamples = parseContentPack(JSON.parse(readFileSync('content/packs/generated-score-sample.json', 'utf8')))
  .lessons.map((lesson) => lesson.spec as ExerciseSpec);
const clock: Clock = { now: () => { throw new Error('explicit timestamps required'); }, dayStart: (time) => Math.floor(time / 86_400_000) * 86_400_000 };

function answer(item: Pick<NextItem, 'key' | 'answerScore'>): Response {
  const key = item.key;
  if (key.type === 'functions') return { kind: 'functions', symbols: [...key.symbols], rtMs: 500 };
  if (key.type === 'locations') return { kind: 'locations', indices: [...key.indices], rtMs: 500 };
  if (key.type !== 'performance') throw new Error('expected exercise answer');
  if (key.mode === 'tapped') return { kind: 'tapped', onsets: key.notes.map((note) => note.start), rtMs: 500 };
  if (key.mode === 'sung') return { kind: 'sung', notes: key.notes.map((note) => ({ ...note })), rtMs: 500 };
  if (!item.answerScore) throw new Error('missing answer score');
  return { kind: 'notation', score: JSON.parse(JSON.stringify(item.answerScore)), rtMs: 500 };
}

describe('exercise type contracts', () => {
  it('registers all nine missing types without changing the daily pool', () => {
    expect(EXERCISE_EXAMPLES).toHaveLength(9);
    expect(EXERCISE_SKILLS).toHaveLength(9);
    expect(SKILLS).toHaveLength(49);
    for (const spec of EXERCISE_EXAMPLES) {
      expect(SKILLS.some((skill) => skill.id === exerciseSkillId(spec.kind))).toBe(false);
      expect(() => validateExerciseSpec(spec)).not.toThrow();
    }
  });

  it('validates and schedules flat keys and compound meters', () => {
    const base = EXERCISE_EXAMPLES.find((spec) => spec.kind === 'melody-imitation');
    if (!base || base.kind === 'harmony-progression' || base.kind === 'interval-singing') throw new Error('missing score exercise');
    const score = {
      ...base.scores[0]!,
      measures: [
        {
          key: { tonic: 10, mode: 'major' as const, fifths: -2 },
          time: { beats: 6, unit: 8 as const },
          voices: [{ notes: [70, 72, 74, 75, 77, 79].map((midi) => ({
            pitch: { midi, name: midi === 70 ? 'Bb4' : midiToName(midi) },
            duration: { value: 8 as const, dots: 0 as const }, tie: false,
          })) }],
        },
        {
          key: { tonic: 2, mode: 'major' as const, fifths: 2 },
          time: { beats: 3, unit: 4 as const },
          voices: [{ notes: [62, 64, 66].map((midi) => ({
            pitch: { midi, name: midiToName(midi) }, duration: { value: 4 as const, dots: 0 as const }, tie: false,
          })) }],
        },
      ],
    };
    const spec = { ...base, id: 'meter-key-regression', questionCount: 1, scores: [score] };
    expect(() => validateExerciseSpec(spec)).not.toThrow();
    const item = generateExercise(spec, 41, factory);
    expect(item.key.type).toBe('performance');
    if (item.key.type !== 'performance') throw new Error('missing performance key');
    expect(item.key.end).toBeCloseTo((6 * 0.5 + 3) * 60_000 / spec.tempoBpm);
    expect(item.presented.inputLeadIn).toHaveLength(6);
    expect(item.presented.inputLeadInMs).toBeCloseTo(6 * 30_000 / spec.tempoBpm);
  });

  it('rejects score key signatures that disagree with tonic and meter units the renderer cannot display', () => {
    const base = EXERCISE_EXAMPLES.find((spec) => spec.kind === 'melody-imitation');
    if (!base || base.kind === 'harmony-progression' || base.kind === 'interval-singing') throw new Error('missing score exercise');
    const score = base.scores[0]!;
    const badKey = { ...score, measures: score.measures.map((measure) => ({ ...measure, key: { ...measure.key, tonic: 7 } })) };
    expect(() => validateExerciseSpec({ ...base, scores: [badKey] })).toThrow(/key tonic and fifths/);
    const badMeter = { ...score, measures: score.measures.map((measure) => ({ ...measure, time: { beats: 4, unit: 3 as unknown as 4 } })) };
    expect(() => validateExerciseSpec({ ...base, scores: [badMeter] })).toThrow(/time signature/);
  });

  it.each(EXERCISE_EXAMPLES)('generates deterministic, scoreable content without revealing the answer: $kind', (spec) => {
    const before = JSON.stringify(spec);
    const variants = new Set<string>();
    for (let sample = 0; sample < 16; sample += 1) {
      const seed = sample * 9973;
      const item = generateExercise(spec, seed, factory);
      expect(generateExercise(spec, seed, factory)).toEqual(item);
      expect(item.presented.exerciseKind).toBe(spec.kind);
      expect(item.presented.targets).toContain(exerciseSkillId(spec.kind));
      expect(item.presented).not.toHaveProperty('key');
      expect(item.presented).not.toHaveProperty('answerScore');
      expect(item.presented.templateKey).not.toContain('scores');
      expect(item.presented.id).not.toContain('sequences');
      variants.add(JSON.stringify([item.presented.score, item.presented.stimulus, item.key]));
      const response = answer(item);
      const responseBefore = JSON.stringify(response);
      expect(judge(item.presented, item.key, response)).toMatchObject({ correct: true, partial: 1, errorType: 'none' });
      expect(JSON.stringify(response)).toBe(responseBefore);
      for (const event of item.presented.stimulus ?? []) {
        expect(event.start).toBeGreaterThanOrEqual(0);
        if (event.kind !== 'click') expect(event.dur).toBeGreaterThan(0);
      }
      if (['harmony-progression', 'rhythm-imitation', 'rhythm-dictation', 'melody-dictation', 'melody-imitation'].includes(spec.kind)) expect(item.presented.score).toBeNull();
      if (spec.kind === 'rhythm-reading') expect(item.presented.stimulus).toBeNull();
      if (['interval-singing', 'melody-singing'].includes(spec.kind)) expect(item.presented.stimulus).toHaveLength(1);
      if (spec.kind === 'interval-singing') {
        const reference = item.presented.stimulus?.[0];
        if (reference?.kind !== 'note') throw new Error('missing reference');
        expect(reference.midi).not.toBe(item.answerPitches[0]?.midi);
      }
      if (spec.kind === 'rhythm-correction') {
        const expected = scoreTimeline(item.presented.score!, spec.tempoBpm);
        const differences = expected.notes.filter((note, index) => note.start !== item.presented.stimulus?.[index]?.start);
        expect(differences).toHaveLength(1);
        expect(item.presented.stimulus?.[0]?.start).toBe(expected.notes[0]?.start);
        if (item.key.type !== 'locations') throw new Error('missing locations');
        expect(item.key.indices).toEqual([differences[0]!.scoreIndex]);
      }
    }
    expect(variants.size).toBeGreaterThan(1);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it.each([...EXERCISE_EXAMPLES, ...generatedExamples])('completes and replays a full session for $kind', (spec) => {
    const lesson = lessonForExercise(spec);
    const request = { mode: 'focus' as const, scope: lesson.module, lesson };
    let state = createSession([], 0, request, clock);
    const rng = makeRng(99);
    const items: NextItem[] = [];
    for (let index = 0; index < spec.questionCount; index += 1) {
      const item = nextItem(state, index * 1_000, rng, factory);
      if (!item) throw new Error('missing item');
      const before = JSON.stringify(state);
      const result = commit(state, item, judge(item.presented, item.key, answer(item)), index * 1_000, clock);
      expect(JSON.stringify(state)).toBe(before);
      expect(result.attempt).toMatchObject({ templateKey: item.presented.templateKey, itemRating: spec.itemRating, predictedP: item.predictedP, lessonId: spec.id, schemaVersion: 2 });
      expect(result.attempt.reviewKeys).toContain(item.presented.skill);
      state = result.state;
      items.push(item);
    }
    expect(nextItem(state, 99_000, rng, factory)).toBeNull();
    const attempts = JSON.parse(JSON.stringify(state.attempts)) as typeof state.attempts;
    expect(replayAbility(attempts)).toEqual(state.snapshot.ability);
    expect(replaySchedule(attempts, clock)).toEqual(state.snapshot.schedule);
    let restored = createSession([], 0, request, clock);
    const replayRng = makeRng(99);
    for (const [index, attempt] of attempts.entries()) {
      const item = nextItem(restored, attempt.at, replayRng, factory)!;
      expect(item).toEqual(items[index]);
      const result = commit(restored, item, attempt.judgement, attempt.at, clock);
      expect(result.attempt).toEqual(attempt);
      restored = result.state;
    }
    expect(restored).toEqual(state);
  });

  it('rejects mismatched lessons, invalid material and nonfinite parameters', () => {
    for (const spec of EXERCISE_EXAMPLES) {
      expect(() => validateExerciseSpec({ ...spec, tempoBpm: NaN })).toThrow();
      expect(() => validateExerciseSpec({ ...spec, policy: { ...spec.policy, onsetMs: -1 } })).toThrow();
      expect(() => validateExerciseSpec({ ...spec, questionCount: 0 })).toThrow();
      expect(() => generateExercise(spec, -1, factory)).toThrow();
      const lesson = lessonForExercise(spec);
      expect(() => createSession([], 0, { mode: 'focus', scope: lesson.module, lesson: { ...lesson, skills: [] } }, clock)).toThrow('does not match');
    }
  });

  it('keeps exercise constraints in template identity while leaving the seed out', () => {
    const spec = EXERCISE_EXAMPLES[0]!;
    const first = generateExercise(spec, 0, factory);
    expect(generateExercise(spec, 99, factory).templateKey).toBe(first.templateKey);
    expect(generateExercise({ ...spec, policy: { ...spec.policy, pitchCents: 20 } }, 0, factory).templateKey).not.toBe(first.templateKey);
    expect(generateExercise({ ...spec, tempoBpm: 100 }, 0, factory).templateKey).not.toBe(first.templateKey);
  });

  it('generates count-in events from the actual meter and leaves source scores untouched', () => {
    const spec = EXERCISE_EXAMPLES.find((entry) => entry.kind === 'rhythm-reading')!;
    if (spec.kind !== 'rhythm-reading') throw new Error('wrong example');
    const score = JSON.parse(JSON.stringify(spec.scores[0])) as NonNullable<typeof spec.scores[0]>;
    score.measures[0]!.time = { beats: 6, unit: 8 };
    score.measures[0]!.voices[0]!.notes = Array.from({ length: 6 }, () => ({ pitch: { midi: 60, name: 'C4' }, duration: { value: 8, dots: 0 }, tie: false }));
    const item = generateExercise({ ...spec, scores: [score] }, 0, factory);
    expect(item.presented.inputLeadIn).toHaveLength(6);
    expect(item.presented.inputLeadInMs).toBeCloseTo(2_000);
    expect(item.presented.notationContext?.time).toEqual({ beats: 6, unit: 8 });
    item.presented.score!.measures[0]!.voices[0]!.notes[0]!.pitch!.midi = 72;
    expect(score.measures[0]!.voices[0]!.notes[0]!.pitch!.midi).toBe(60);
    expect(item.answerScore?.measures[0]?.voices[0]?.notes[0]?.pitch?.midi).toBe(60);
  });

  it('generates reproducible, complete rhythm and diatonic score material from rules', () => {
    const rhythmBase = EXERCISE_EXAMPLES.find((entry) => entry.kind === 'rhythm-reading');
    const melodyBase = EXERCISE_EXAMPLES.find((entry) => entry.kind === 'melody-singing');
    if (!rhythmBase || rhythmBase.kind !== 'rhythm-reading' || !melodyBase || melodyBase.kind !== 'melody-singing') throw new Error('missing generator examples');
    const rhythm = {
      ...rhythmBase, scores: [], generator: {
        kind: 'rhythm-grid' as const, version: 1 as const, clef: 'treble' as const,
        key: { tonic: 0, mode: 'major' as const, fifths: 0 }, time: { beats: 4, unit: 4 as const },
        measures: 4, durations: [{ value: 2 as const, dots: 0 as const }, { value: 4 as const, dots: 0 as const }, { value: 8 as const, dots: 0 as const }],
        restProbability: 15,
      },
    };
    const melody = {
      ...melodyBase, scores: [], generator: {
        ...rhythm.generator, kind: 'diatonic-melody' as const, pitchRange: [60, 72] as const, maxLeapSemitones: 5,
      },
    };
    const seenRhythms = new Set<string>();
    for (let seed = 0; seed < 64; seed += 1) {
      const rhythmItem = generateExercise(rhythm, seed, factory);
      expect(generateExercise(rhythm, seed, factory)).toEqual(rhythmItem);
      const rhythmScore = rhythmItem.answerScore!;
      expect(rhythmScore.measures).toHaveLength(4);
      for (const measure of rhythmScore.measures) {
        expect(measure.voices[0]!.notes.reduce((sum, note) => sum + 4 / note.duration.value, 0)).toBe(4);
        expect(measure.voices[0]!.notes.every((note) => [2, 4, 8].includes(note.duration.value))).toBe(true);
      }
      seenRhythms.add(JSON.stringify(rhythmScore.measures.map((measure) => measure.voices[0]!.notes.map((note) => [note.pitch === null, note.duration.value]))));

      const melodyItem = generateExercise(melody, seed, factory);
      expect(generateExercise(melody, seed, factory)).toEqual(melodyItem);
      const pitches = melodyItem.answerScore!.measures.flatMap((measure) => measure.voices[0]!.notes.flatMap((note) => note.pitch ? [note.pitch.midi] : []));
      expect(pitches.length).toBeGreaterThan(0);
      expect(pitches.every((midi) => midi >= 60 && midi <= 72 && [0, 2, 4, 5, 7, 9, 11].includes(midi % 12))).toBe(true);
      expect(pitches.slice(1).every((midi, index) => Math.abs(midi - pitches[index]!) <= 5)).toBe(true);
    }
    expect(seenRhythms.size).toBeGreaterThan(32);
  });

  it('rejects impossible or mismatched generation rules', () => {
    const base = EXERCISE_EXAMPLES.find((entry) => entry.kind === 'rhythm-reading');
    if (!base || base.kind !== 'rhythm-reading') throw new Error('missing rhythm example');
    const generated = {
      ...base, scores: [], generator: {
        kind: 'rhythm-grid' as const, version: 1 as const, clef: 'treble' as const,
        key: { tonic: 0, mode: 'major' as const, fifths: 0 }, time: { beats: 4, unit: 4 as const },
        measures: 2, durations: [{ value: 4 as const, dots: 0 as const }], restProbability: 0,
      },
    };
    expect(() => validateExerciseSpec({ ...generated, kind: 'melody-singing' })).toThrow(/does not match/);
    expect(() => validateExerciseSpec({ ...generated, generator: { ...generated.generator, time: { beats: 3, unit: 8 as const }, durations: [{ value: 4 as const, dots: 0 as const }] } })).toThrow(/cannot produce/);
    expect(() => validateExerciseSpec({ ...generated, scores: [base.scores[0]!] })).toThrow(/must not include static/);
  });

  it('reports individual harmony errors and rejects duplicate correction locations', () => {
    const harmony = generateExercise(EXERCISE_EXAMPLES.find((spec) => spec.kind === 'harmony-progression')!, 0, factory);
    if (harmony.key.type !== 'functions') throw new Error('wrong key');
    const symbols = [...harmony.key.symbols];
    symbols[1] = 'V';
    const result = judge(harmony.presented, harmony.key, { kind: 'functions', symbols, rtMs: 0 });
    expect(result).toMatchObject({ correct: false, partial: 0.75, errorType: 'function' });
    expect(result.details?.[1]?.errors).toEqual(['function']);
    expect(judge(harmony.presented, harmony.key, { kind: 'functions', symbols: [], rtMs: 0 }).partial).toBe(0);
    const correction = generateExercise(EXERCISE_EXAMPLES.find((spec) => spec.kind === 'rhythm-correction')!, 0, factory);
    if (correction.key.type !== 'locations') throw new Error('wrong key');
    expect(judge(correction.presented, correction.key, { kind: 'locations', indices: [], rtMs: 0 }).correct).toBe(false);
    expect(() => judge(correction.presented, correction.key, { kind: 'locations', indices: [0, 0], rtMs: 0 })).toThrow();
    expect(() => judge(correction.presented, correction.key, { kind: 'locations', indices: [999], rtMs: 0 })).toThrow();
  });
});
