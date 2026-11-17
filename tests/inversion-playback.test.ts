import { ALL_PRACTICE_SPECS, getSkill, inversionSkillsForSpec, practiceSpecForLesson, validatePracticeSpec } from '@engine/config';
import { generate } from '@engine/items';
import { judge } from '@engine/scoring';
import type { Attempt, ChoicePracticeSpec, Direction, ItemFeatures } from '@engine/ports';
import { inversionPlaybackCase } from '../src/store/course-library';
import { contentPilotCases, createPilotStore, PILOT_CASES } from '../src/store/pilot';
import { readContentPacks } from '../scripts/content-files';
import { makeRngFactory } from './support/rng';

const factory = makeRngFactory();
const features: ItemFeatures = { register: 'mid', direction: 'harmonic', reference: 'none', timbre: 'piano', tempoBpm: 90, voices: 1, bars: 1, chunk: 1 };

it.each(ALL_PRACTICE_SPECS.filter((spec) => spec.task.kind === 'chord-inversion'))('preserves bass-based answers for ascending and descending $id', (base) => {
  for (const skill of inversionSkillsForSpec(base)) for (const root of [48, 61, 66]) {
    const harmonic: ChoicePracticeSpec = { ...base, stimulus: { ...base.stimulus, rootMidi: [root, root] } };
    const original = generate(skill, features, 42, factory, undefined, harmonic);
    const ascending = original.answerPitches.map((pitch) => pitch.midi);
    expect(ascending).toEqual([...ascending].sort((first, second) => first - second));
    for (const direction of ['asc', 'desc'] as const) {
      const spec = { ...harmonic, stimulus: { ...harmonic.stimulus, direction } };
      expect(() => validatePracticeSpec(spec)).not.toThrow();
      const item = generate(skill, features, 42, factory, undefined, spec);
      expect(generate(skill, features, 42, factory, undefined, spec)).toEqual(item);
      expect(item.answerPitches).toEqual(original.answerPitches);
      expect(item.key).toEqual(original.key);
      expect(item.templateKey).not.toBe(original.templateKey);
      const events = item.presented.stimulus!;
      expect(events.map((event) => event.kind === 'note' ? event.midi : null)).toEqual(direction === 'asc' ? ascending : [...ascending].reverse());
      expect(events.map((event) => event.start)).toEqual(ascending.map((_, index) => index * 333));
      expect(events.every((event) => event.kind === 'note' && event.dur === 300)).toBe(true);
      if (item.key.type !== 'choice') throw new Error('expected choice');
      expect(item.presented.options![item.key.index]).toBe(getSkill(skill).code);
      expect(judge(item.presented, item.key, { kind: 'choice', index: item.key.index, rtMs: 0 }).correct).toBe(true);
    }
  }
});

it('keeps validation boundaries for invalid directions and overflowing arpeggios', () => {
  const base = ALL_PRACTICE_SPECS[0]!;
  expect(() => validatePracticeSpec({ ...base, stimulus: { ...base.stimulus, direction: 'sideways' as Direction } })).toThrow('invalid inversions');
  for (const direction of ['asc', 'desc'] as const) {
    expect(() => validatePracticeSpec({ ...base, stimulus: { ...base.stimulus, direction, rootMidi: [115, 115] } })).not.toThrow();
    expect(() => validatePracticeSpec({ ...base, stimulus: { ...base.stimulus, direction, rootMidi: [116, 116] } })).toThrow('MIDI');
  }
  expect(() => inversionPlaybackCase(PILOT_CASES.find((example) => example.id === 'comparison')!, 'asc')).toThrow('expected inversion lesson');
});

it('runs every authored inversion course in all three modes with reproducible rounds and stored directions', async () => {
  const examples = (await readContentPacks()).flatMap(({ pack }) => contentPilotCases(pack))
    .filter((example) => example.lesson.practiceSpec?.task.kind === 'chord-inversion');
  expect(examples.length).toBeGreaterThan(0);
  for (const example of examples) for (const direction of ['harmonic', 'asc', 'desc'] as const) {
    const before = JSON.stringify(example);
    const variant = inversionPlaybackCase(example, direction);
    expect(practiceSpecForLesson(variant.lesson)?.stimulus.direction).toBe(direction);
    if (direction === example.lesson.practiceSpec!.stimulus.direction) expect(variant).toBe(example);
    else expect(variant.id).not.toBe(example.id);
    const rounds: unknown[][] = [];
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const attempts: Attempt[] = [];
      const store = await createPilotStore({ loadAll: async () => [], append: async (attempt) => { attempts.push(attempt); }, exportJson: async () => JSON.stringify(attempts) },
        { now: () => 0, dayStart: () => 0 }, factory, 'piano', 'original', undefined, 'course');
      let item = store.startCase(variant) as ReturnType<typeof store.next>;
      const round: unknown[] = [];
      while (item) {
        round.push(item);
        if (item.key.type !== 'choice') throw new Error('expected choice');
        await store.commit({ kind: 'choice', index: item.key.index, rtMs: 0 });
        expect(item.presented.features.direction).toBe(direction);
        expect(attempts.at(-1)!.lessonId).toBe(variant.lesson.id);
        expect(attempts.at(-1)!.templateKey).toContain(`"direction":"${direction}"`);
        expect(attempts.at(-1)!.templateKey).toBe(item.presented.templateKey);
        item = store.next();
      }
      expect(store.result().completed).toBe(variant.lesson.practiceSpec!.questionCount);
      rounds.push(round);
    }
    expect(rounds[0]).toEqual(rounds[1]);
    expect(JSON.stringify(example)).toBe(before);
  }
});
