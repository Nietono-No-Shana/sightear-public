import {
  COMPARISON_SKILLS, COURSES, INITIAL_PRACTICE_SPECS, INTERVAL_COMPARISON_COURSE,
  SKILLS, getSkill, skillsForPracticeSpec, type ChoicePracticeSpec,
} from '@engine/config';
import { generate } from '@engine/items';
import type { ItemFeatures, SkillId } from '@engine/ports';
import { judge } from '@engine/scoring';
import { makeRngFactory } from './support/rng';

const factory = makeRngFactory();
const features: ItemFeatures = {
  register: 'low', direction: 'asc', reference: 'none', timbre: 'piano',
  tempoBpm: 90, voices: 1, bars: 1, chunk: 1,
};
const spec = INITIAL_PRACTICE_SPECS[10]!;

function comparison(code: 'a-larger' | 'b-larger' | 'equal', seed: number, bounded = spec) {
  const skill: SkillId = `interval.compare.common-first.${code}`;
  return generate(skill, features, seed, factory, undefined, bounded);
}

describe('common-first interval comparison', () => {
  it('registers only course skills and keeps the unverified UI disabled', () => {
    expect(spec.availability).toBe('engine-ready');
    expect(COURSES).not.toContain(INTERVAL_COMPARISON_COURSE);
    expect(INTERVAL_COMPARISON_COURSE.modules[0]?.lessons[0]?.questionCount).toBe(12);
    expect(skillsForPracticeSpec(spec)).toEqual(['interval.compare.common-first.a-larger', 'interval.compare.common-first.b-larger']);
    for (const skill of COMPARISON_SKILLS) {
      expect(getSkill(skill.id)).toEqual(skill);
      expect(SKILLS.some((entry) => entry.id === skill.id)).toBe(false);
    }
  });

  it('compares spans, reverses answers when swapping A/B, and preserves the two-beat silent gap', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed += 1) {
      const larger = comparison('a-larger', seed);
      const smaller = comparison('b-larger', seed);
      expect(comparison('a-larger', seed)).toEqual(larger);
      const first = larger.answerPitches.map((pitch) => pitch.midi);
      const second = smaller.answerPitches.map((pitch) => pitch.midi);
      expect(first[0]).toBe(first[2]);
      expect(first[0]).toBeGreaterThanOrEqual(48);
      expect(first[0]).toBeLessThanOrEqual(59);
      expect(first[1]).toBeGreaterThan(first[3]!);
      expect(second).toEqual([first[2], first[3], first[0], first[1]]);
      const spanA = first[1]! - first[0]!;
      const spanB = first[3]! - first[2]!;
      expect([5, 7, 12]).toContain(spanA);
      expect([5, 7, 12]).toContain(spanB);
      seen.add(`${spanA}:${spanB}`);
      const events = larger.presented.stimulus!;
      expect(events).toHaveLength(4);
      events.forEach((event) => expect(event.kind).toBe('note'));
      const lastA = events[1]!;
      if (lastA.kind !== 'note') throw new Error('expected note');
      expect(events[2]!.start - lastA.start - lastA.dur).toBe(Math.round(2 * 60_000 / 90));
      expect(larger.presented.score).toBeNull();
      expect(larger.presented.prompt).toBe('比较音程 A 与 B 的大小');
      expect(larger.presented.options).not.toContain('equal');
      if (larger.key.type !== 'choice') throw new Error('expected choice');
      expect(larger.presented.options?.[larger.key.index]).toBe('a-larger');
      expect(judge(larger.presented, larger.key, { kind: 'choice', index: larger.key.index, rtMs: 500 }).correct).toBe(true);
      expect(judge(larger.presented, larger.key, { kind: 'choice', index: 1 - larger.key.index, rtMs: 500 }).correct).toBe(false);
    }
    expect(seen).toEqual(new Set(['7:5', '12:5', '12:7']));
  });

  it('preserves the comparison under transposition and supports an explicitly enabled equal answer', () => {
    if (spec.task.kind !== 'interval-comparison') throw new Error('expected comparison spec');
    const equal: ChoicePracticeSpec = { ...spec, task: { ...spec.task, allowEqual: true } };
    for (let seed = 0; seed < 20; seed += 1) {
      const item = comparison('equal', seed, equal);
      expect(item.answerPitches[1]?.midi).toBe(item.answerPitches[3]?.midi);
      if (item.key.type !== 'choice') throw new Error('expected choice');
      expect(item.presented.options?.[item.key.index]).toBe('equal');
      const low = comparison('a-larger', seed, { ...spec, stimulus: { ...spec.stimulus, rootMidi: [48, 48] } });
      const high = comparison('a-larger', seed, { ...spec, stimulus: { ...spec.stimulus, rootMidi: [60, 60] } });
      expect(high.answerPitches.map((pitch) => pitch.midi)).toEqual(low.answerPitches.map((pitch) => pitch.midi + 12));
      expect(high.key).toEqual(low.key);
      expect(high.presented.options).toEqual(low.presented.options);
    }
    expect(() => comparison('equal', 0)).toThrow('outside practice spec');
    expect(() => generate('interval.compare.common-first.a-larger', features, 0, factory)).toThrow('requires a practice spec');
  });

  it('handles compound spans at MIDI 127 and rejects an overflowing root', () => {
    if (spec.task.kind !== 'interval-comparison') throw new Error('expected comparison spec');
    const boundary: ChoicePracticeSpec = {
      ...spec, task: { ...spec.task, semitones: [1, 24] }, stimulus: { ...spec.stimulus, rootMidi: [103, 103] },
    };
    expect(comparison('a-larger', 1, boundary).answerPitches.map((pitch) => pitch.midi)).toEqual([103, 127, 103, 104]);
    expect(() => comparison('a-larger', 1, { ...boundary, stimulus: { ...boundary.stimulus, rootMidi: [104, 104] } })).toThrow('MIDI');
  });
});
