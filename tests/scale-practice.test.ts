import {
  COURSES, INITIAL_PRACTICE_SPECS, SCALE_IDENTIFICATION_COURSE, SCALE_SKILLS, SKILLS,
  getSkill, practiceSpecForLesson, skillsForPracticeSpec, type ChoicePracticeSpec,
} from '@engine/config';
import { SCALE_INTERVALS } from '@engine/theory';
import { generate } from '@engine/items';
import type { Clock, ItemFeatures, PracticeRequest, ScaleMode, SkillId } from '@engine/ports';
import { judge } from '@engine/scoring';
import { commit, createSession, nextItem } from '@engine/session';
import { makeRng, makeRngFactory } from './support/rng';

const factory = makeRngFactory();
const features: ItemFeatures = {
  register: 'mid', direction: 'asc', reference: 'none', timbre: 'piano',
  tempoBpm: 120, voices: 1, bars: 1, chunk: 1,
};
const specs = INITIAL_PRACTICE_SPECS.filter((spec) => spec.task.kind === 'scale-identification');
const offsetsFor = (mode: ScaleMode): readonly number[] => [...SCALE_INTERVALS[mode], 12];
const clock: Clock = { now: () => 0, dayStart: (time) => Math.floor(time / 86_400_000) * 86_400_000 };

describe('scale practice engine', () => {
  it('registers a separate domain without changing the daily pool or enabling an unverified UI', () => {
    expect(SKILLS).toHaveLength(49);
    expect(SCALE_SKILLS).toHaveLength(Object.keys(SCALE_INTERVALS).length);
    expect(SCALE_IDENTIFICATION_COURSE.modules[0]?.lessons).toHaveLength(3);
    expect(COURSES).not.toContain(SCALE_IDENTIFICATION_COURSE);
    for (const skill of SCALE_SKILLS) {
      expect(getSkill(skill.id)).toEqual(skill);
      expect(skill.domain).toBe('scale');
      expect(SKILLS.some((entry) => entry.id === skill.id)).toBe(false);
    }
  });

  it.each(specs)('generates the exact modes, octave and answer set for $id', (spec) => {
    expect(spec.availability).toBe('engine-ready');
    if (spec.task.kind !== 'scale-identification') throw new Error('expected scale task');
    const before = JSON.stringify(spec);
    for (const skill of skillsForPracticeSpec(spec)) {
      const meta = getSkill(skill);
      if (meta.kind !== 'scale') throw new Error('expected scale skill');
      for (let root = 48; root <= 59; root += 1) {
        const bounded: ChoicePracticeSpec = { ...spec, stimulus: { ...spec.stimulus, rootMidi: [root, root] } };
        const item = generate(skill, features, root, factory, undefined, bounded);
        expect(generate(skill, features, root, factory, undefined, bounded)).toEqual(item);
        expect(item.presented.features).toMatchObject({ tempoBpm: 90, reference: 'none', direction: 'asc' });
        expect(item.presented.prompt).toBe('识别音阶');
        expect(item.presented.score).toBeNull();
        expect(item.presented).not.toHaveProperty('answerPitches');
        const notes = item.presented.stimulus;
        expect(notes).toHaveLength(8);
        if (!notes || item.key.type !== 'choice' || !item.presented.options) throw new Error('missing scale data');
        notes.forEach((note, index) => {
          expect(note).toMatchObject({
            kind: 'note', midi: root + offsetsFor(meta.mode)[index]!,
            start: Math.round(index * 60_000 / 90), dur: 600,
          });
        });
        expect(item.answerPitches.map((pitch) => pitch.midi)).toEqual(offsetsFor(meta.mode).map((offset) => root + offset));
        expect([...item.presented.options].sort()).toEqual([...spec.task.modes].sort());
        expect(item.presented.options[item.key.index]).toBe(meta.mode);
        expect(judge(item.presented, item.key, { kind: 'choice', index: item.key.index, rtMs: 100 }).correct).toBe(true);
        const wrong = judge(item.presented, item.key, { kind: 'choice', index: (item.key.index + 1) % item.presented.options.length, rtMs: 100 });
        expect(wrong.correct).toBe(false);
        expect(wrong.confusion).not.toBeNull();
      }
    }
    expect(JSON.stringify(spec)).toBe(before);
  });

  it.each([0, 115])('accepts the octave boundary at root MIDI %i', (root) => {
    const spec = specs[0]!;
    const item = generate('scale.identify.major', features, 1, factory, undefined, {
      ...spec, stimulus: { ...spec.stimulus, rootMidi: [root, root] },
    });
    expect(item.answerPitches[0]?.midi).toBe(root);
    expect(item.answerPitches[7]?.midi).toBe(root + 12);
  });

  it('rejects overflow, excluded modes, unimplemented tasks and simultaneous scales', () => {
    const spec = specs[0]!;
    expect(() => generate('scale.identify.major', features, 0, factory, undefined, {
      ...spec, stimulus: { ...spec.stimulus, rootMidi: [116, 116] },
    })).toThrow('MIDI range');
    expect(() => generate('scale.identify.harmonicMinor', features, 0, factory, undefined, spec)).toThrow('outside practice spec');
    expect(() => generate('scale.identify.major', features, 0, factory, undefined, INITIAL_PRACTICE_SPECS[10]!)).toThrow('outside practice spec');
    expect(() => generate('scale.identify.major', { ...features, direction: 'harmonic' }, 0, factory)).toThrow('melodic direction');
  });

  it('rejects scale sessions without a bounded course lesson', () => {
    for (const mode of ['daily', 'focus'] as const) {
      expect(() => createSession([], 0, { mode, scope: 'scale', limit: 12 }, clock)).toThrow('requires a lesson');
    }
  });

  it.each(SCALE_SKILLS)('preserves mode intervals when descending: $id', (skill) => {
    const ascending = generate(skill.id, features, 5, factory);
    const descending = generate(skill.id, { ...features, direction: 'desc' }, 5, factory);
    expect(descending.answerPitches).toEqual([...ascending.answerPitches].reverse());
    expect(descending.key).toEqual(ascending.key);
    expect(descending.presented.options).toEqual(ascending.presented.options);
  });

  it.each(SCALE_IDENTIFICATION_COURSE.modules[0]!.lessons)('completes twelve questions within the material set: $id', (entry) => {
    const lesson = entry.lesson!;
    expect(lesson.module).toBe('scale');
    const spec = practiceSpecForLesson(lesson)!;
    expect(spec.id).toBe(entry.id);
    const request: PracticeRequest = { mode: 'focus', scope: 'scale', lesson, limit: entry.questionCount ?? 12 };
    let state = createSession([], 0, request, clock);
    expect(state.plan.scope).toBe('scale');
    const rng = makeRng(42);
    const seen = new Set<SkillId>();
    for (let index = 0; index < 12; index += 1) {
      const item = nextItem(state, index * 1_000, rng, factory);
      if (!item || item.key.type !== 'choice') throw new Error('missing scale item');
      seen.add(item.presented.skill);
      expect(lesson.skills).toContain(item.presented.skill);
      expect(item.presented.templateKey).toContain(`${spec.id}@1`);
      const result = commit(state, item, judge(item.presented, item.key, { kind: 'choice', index: item.key.index, rtMs: 500 }), index * 1_000, clock);
      expect(result.attempt.lessonId).toBe(lesson.id);
      expect(result.attempt.reviewKeys).toContain(item.presented.skill);
      expect(result.attempt.itemRating).toBe(item.itemRating);
      expect(result.attempt.predictedP).toBe(item.predictedP);
      state = result.state;
    }
    expect(seen).toEqual(new Set(lesson.skills));
    expect(nextItem(state, 12_000, rng, factory)).toBeNull();
    expect(state.attempts).toHaveLength(12);
    expect(() => practiceSpecForLesson({ ...lesson, module: 'chord' })).toThrow('does not match');
  });
});
