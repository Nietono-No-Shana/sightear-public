import {
  ALL_PRACTICE_SPECS, EXTENDED_INVERSION_SKILLS, EXTENDED_INVERSION_SPECS,
  INITIAL_PRACTICE_SPECS, SKILLS, chordInversionSkillId, getSkill, inversionSkillsForSpec,
  validatePracticeSpec, type ChoicePracticeSpec, type InversionQuality,
} from '@engine/config';
import { generate } from '@engine/items';
import type { ItemFeatures } from '@engine/ports';
import { makeRngFactory } from './support/rng';

const features: ItemFeatures = {
  register: 'low', direction: 'harmonic', reference: 'none', timbre: 'piano',
  tempoBpm: 90, voices: 1, bars: 1, chunk: 1,
};
const factory = makeRngFactory();
const offsets = {
  diminished: [0, 3, 6], dominant7: [0, 4, 7, 10], major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10], halfDiminished7: [0, 3, 6, 10],
};

describe('extended inversion curriculum', () => {
  it('adds twenty explicit designs while preserving the original specifications and daily skills', () => {
    expect(EXTENDED_INVERSION_SPECS).toHaveLength(20);
    expect(ALL_PRACTICE_SPECS).toHaveLength(31);
    expect(ALL_PRACTICE_SPECS.slice(0, 11)).toEqual(INITIAL_PRACTICE_SPECS);
    expect(new Set(ALL_PRACTICE_SPECS.map((spec) => spec.id)).size).toBe(31);
    expect(SKILLS).toHaveLength(49);
    expect(EXTENDED_INVERSION_SKILLS).toHaveLength(67);
    for (const skill of EXTENDED_INVERSION_SKILLS) {
      expect(SKILLS.some((entry) => entry.id === skill.id)).toBe(false);
      expect(getSkill(skill.id)).toEqual(skill);
    }
    expect(chordInversionSkillId('dominant7', 3)).toBe('chord.inversion.dominant7.third');
    expect(getSkill('chord.inversion.third')).toMatchObject({ quality: 'dominant7', inversion: 3 });
    expect(chordInversionSkillId('diminished7', 3)).toBe('chord.inversion.diminished7.third');
    expect(chordInversionSkillId('augmented', 2)).toBe('chord.inversion.augmented.second');
  });

  it.each(EXTENDED_INVERSION_SPECS)('generates exact closed voicings and unique answers for $id', (spec) => {
    const before = JSON.stringify(spec);
    for (const skill of inversionSkillsForSpec(spec)) {
      const meta = getSkill(skill);
      if (meta.kind !== 'chord-inversion') throw new Error('wrong skill');
      const base = offsets[meta.quality as keyof typeof offsets];
      const expected = [...base.slice(meta.inversion), ...base.slice(0, meta.inversion).map((pitch) => pitch + 12)];
      for (let root = 48; root < 60; root += 1) {
        const bounded: ChoicePracticeSpec = { ...spec, stimulus: { ...spec.stimulus, rootMidi: [root, root] } };
        const item = generate(skill, features, root, factory, undefined, bounded);
        expect(generate(skill, features, root, factory, undefined, bounded)).toEqual(item);
        expect(item.answerPitches.map((pitch) => pitch.midi)).toEqual(expected.map((pitch) => root + pitch));
        expect(item.presented.stimulus).toEqual([{ kind: 'chord', midis: expected.map((pitch) => root + pitch), start: 0, dur: 1200, timbre: 'piano' }]);
        if (item.key.type !== 'choice') throw new Error('wrong answer');
        expect(item.presented.options?.[item.key.index]).toBe(meta.code);
        expect(new Set(item.presented.options).size).toBe(item.presented.options?.length);
      }
    }
    expect(JSON.stringify(spec)).toBe(before);
  });

  it.each(EXTENDED_INVERSION_SPECS)('uses the actual voicing span for MIDI boundary validation: $id', (spec) => {
    let span = 0;
    for (const skill of inversionSkillsForSpec(spec)) {
      const item = generate(skill, features, 1, factory, undefined, {
        ...spec, stimulus: { ...spec.stimulus, rootMidi: [0, 0] },
      });
      span = Math.max(span, ...item.answerPitches.map((pitch) => pitch.midi));
    }
    const edge = 127 - span;
    const bounded = { ...spec, stimulus: { ...spec.stimulus, rootMidi: [edge, edge] as const } };
    expect(() => validatePracticeSpec(bounded)).not.toThrow();
    for (const skill of inversionSkillsForSpec(bounded)) {
      const item = generate(skill, features, 1, factory, undefined, bounded);
      expect(Math.max(...item.answerPitches.map((pitch) => pitch.midi))).toBeLessThanOrEqual(127);
    }
    expect(() => validatePracticeSpec({ ...spec, stimulus: { ...spec.stimulus, rootMidi: [edge + 1, edge + 1] } })).toThrow('MIDI');
  });

  it('rejects third-inversion triads and symmetric inversions without a root context', () => {
    const spec = EXTENDED_INVERSION_SPECS[0]!;
    for (const quality of ['major', 'minor', 'diminished', 'augmented', 'suspended4', 'majorFlat5', 'majorSharp5'] as const) {
      expect(() => chordInversionSkillId(quality, 3)).toThrow('invalid chord inversion');
      expect(() => validatePracticeSpec({ ...spec, task: { kind: 'chord-inversion', qualities: [quality], inversions: [0, 3] } })).toThrow('invalid inversions');
    }
    for (const quality of ['augmented', 'majorSharp5', 'diminished7', 'dominant7Flat5'] as const) {
      expect(() => chordInversionSkillId(quality, 0)).not.toThrow();
      expect(() => validatePracticeSpec({ ...spec, task: { kind: 'chord-inversion', qualities: [quality], inversions: [0, 1, 2] } })).toThrow('ambiguous chord inversions');
      expect(() => validatePracticeSpec({ ...spec, stimulus: { ...spec.stimulus, reference: 'tonic' }, task: { kind: 'chord-inversion', qualities: [quality], inversions: [0, 1, 2] } })).not.toThrow();
    }
    expect(() => validatePracticeSpec({ ...spec, task: { kind: 'chord-inversion', qualities: ['dominant7Sharp5'], inversions: [0, 1] } })).not.toThrow();
  });
});
