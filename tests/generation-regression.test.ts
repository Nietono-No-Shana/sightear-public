import { SKILLS, COURSE_SKILLS, EXTENDED_CHORD_SKILLS, EXTENDED_INVERSION_SKILLS, templateKey, templateRating } from '@engine/config';
import { generate } from '@engine/items';
import type { Direction, ItemFeatures, Reference, Register, SoundEvent } from '@engine/ports';
import { judge } from '@engine/scoring';
import { makeRngFactory } from './support/rng';

const factory = makeRngFactory();
const registers: readonly Register[] = ['low', 'mid', 'high'];
const directions: readonly Direction[] = ['asc', 'desc', 'harmonic'];
const references: readonly Reference[] = ['none', 'tonic', 'chord'];

function checkSound(event: SoundEvent): void {
  expect(Number.isFinite(event.start)).toBe(true);
  expect(event.start).toBeGreaterThanOrEqual(0);
  if (event.kind === 'click') return;
  expect(Number.isFinite(event.dur)).toBe(true);
  expect(event.dur).toBeGreaterThan(0);
  const midis = event.kind === 'note' ? [event.midi] : event.midis;
  expect(midis.length).toBeGreaterThan(0);
  for (const midi of midis) {
    expect(Number.isInteger(midi)).toBe(true);
    expect(midi).toBeGreaterThanOrEqual(0);
    expect(midi).toBeLessThanOrEqual(127);
  }
}

function checkItem(skill: (typeof SKILLS)[number], features: ItemFeatures, seed: number): void {
  const item = generate(skill.id, features, seed, factory);
  expect(generate(skill.id, features, seed, factory)).toEqual(item);
  expect(item.templateKey).toBe(templateKey(skill.id, features));
  expect(Number.isFinite(templateRating(skill.id, features))).toBe(true);
  expect(item.targets).toContain(skill.id);
  expect(item.presented.score).toBeNull();
  expect(item.presented).not.toHaveProperty('answerPitches');
  expect(item.presented).not.toHaveProperty('key');
  const stimulus = item.presented.stimulus;
  if (!stimulus || item.key.type !== 'choice') throw new Error('expected playable choice');
  expect(stimulus.length).toBeGreaterThan(0);
  stimulus.forEach(checkSound);
  const options = item.presented.options;
  if (!options) throw new Error('expected options');
  expect(options[item.key.index]).toBe(skill.code);
  expect(new Set(options).size).toBe(options.length);
  expect(judge(item.presented, item.key, { kind: 'choice', index: item.key.index, rtMs: 0 }).correct).toBe(true);
}

describe('all configured skills', () => {
  it.each([...SKILLS, ...COURSE_SKILLS, ...EXTENDED_CHORD_SKILLS, ...EXTENDED_INVERSION_SKILLS])('generates deterministic, valid stimuli and answers for $id', (skill) => {
    for (const register of registers) {
      for (const direction of directions) {
        for (const reference of references) {
          const features: ItemFeatures = {
            register, direction, reference, timbre: 'piano', tempoBpm: 120,
            voices: 1, bars: 1, chunk: 1,
          };
          checkItem(skill, features, 0);
          checkItem(skill, features, 0x7ffffffe);
        }
      }
    }
  });
});
