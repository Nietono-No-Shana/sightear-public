import { INITIAL_PRACTICE_SPECS, inversionSkillsForSpec, type ChoicePracticeSpec } from '@engine/config';
import { generate } from '@engine/items';
import type { ItemFeatures } from '@engine/ports';
import { makeRngFactory } from './support/rng';

const factory = makeRngFactory();
const features: ItemFeatures = {
  register: 'mid', direction: 'asc', reference: 'tonic', timbre: 'piano',
  tempoBpm: 120, voices: 1, bars: 1, chunk: 1,
};
const spec = INITIAL_PRACTICE_SPECS[2]!;
const skill = 'chord.inversion.major.second';

describe('constrained inversion generation', () => {
  it.each([0, 111])('honors a fixed root at MIDI %i without exceeding MIDI bounds', (root) => {
    const bounded: ChoicePracticeSpec = { ...spec, stimulus: { ...spec.stimulus, rootMidi: [root, root] } };
    const result = generate(skill, features, 7, factory, undefined, bounded);
    const sound = result.presented.stimulus?.[0];
    if (sound?.kind !== 'chord') throw new Error('expected chord');
    expect(sound.midis).toEqual([root + 7, root + 12, root + 16]);
    expect(Math.max(...sound.midis)).toBeLessThanOrEqual(127);
    expect(generate(skill, features, 7, factory, undefined, bounded)).toEqual(result);
  });

  it('rejects overflowing roots and skills outside the material set', () => {
    expect(() => generate(skill, features, 7, factory, undefined, {
      ...spec, stimulus: { ...spec.stimulus, rootMidi: [112, 112] },
    })).toThrow('MIDI range');
    expect(() => generate('chord.inversion.minor.second', features, 7, factory, undefined, spec)).toThrow('outside practice spec');
  });

  it('separates material and root constraints in template identity without mutating inputs', () => {
    const before = JSON.stringify({ features, spec });
    const baseline = generate(skill, features, 7, factory, undefined, spec);
    const variants: readonly ChoicePracticeSpec[] = [
      { ...spec, stimulus: { ...spec.stimulus, rootMidi: [49, 59] } },
      { ...spec, task: { kind: 'chord-inversion', qualities: ['major'], inversions: [0, 2] } },
    ];
    for (const variant of variants) {
      const result = generate(skill, features, 7, factory, undefined, variant);
      expect(result.templateKey).not.toBe(baseline.templateKey);
      expect(result.presented.id).not.toBe(baseline.presented.id);
    }
    expect(JSON.stringify({ features, spec })).toBe(before);
    expect(inversionSkillsForSpec(spec)).toContain(skill);
  });
});
