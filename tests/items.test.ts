import {
  confusionKey,
  getSkill,
  getStage,
  SKILLS,
  stageOf,
  STAGES,
  templateKey,
  templateRating,
} from '@engine/config';
import { generate } from '@engine/items';
import type { ItemFeatures, SkillId, SoundEvent } from '@engine/ports';
import { makeRngFactory } from './support/rng';

const features: ItemFeatures = {
  register: 'mid',
  direction: 'asc',
  reference: 'none',
  timbre: 'piano',
  tempoBpm: 120,
  voices: 1,
  bars: 1,
  chunk: 1,
};

const skill: SkillId = 'interval.identify.m3';
const factory = makeRngFactory();

function choiceIndex(item: ReturnType<typeof generate>): number {
  if (item.key.type !== 'choice') throw new Error('expected choice key');
  return item.key.index;
}

function stimulusOf(item: ReturnType<typeof generate>): readonly SoundEvent[] {
  const stimulus = item.presented.stimulus;
  if (stimulus === null) throw new Error('expected stimulus');
  return stimulus;
}

describe('config', () => {
  it('defines unique M1 skills with playable options', () => {
    expect(SKILLS.length).toBeGreaterThan(0);
    expect(new Set(SKILLS.map((entry) => entry.id)).size).toBe(SKILLS.length);
    for (const entry of SKILLS) {
      expect(entry.stage).toBe('S1');
      expect(entry.options).toContain(entry.code);
      expect(entry.pairs.length).toBeGreaterThan(0);
    }
  });

  it('preserves legacy dominant-seventh inversion skill IDs and quality', () => {
    for (const [id, inversion] of [
      ['chord.inversion.root', 0],
      ['chord.inversion.first', 1],
      ['chord.inversion.second', 2],
      ['chord.inversion.third', 3],
    ] as const) {
      const meta = getSkill(id);
      expect(meta.kind).toBe('chord-inversion');
      if (meta.kind !== 'chord-inversion') throw new Error('expected inversion skill');
      expect(meta.quality).toBe('dominant7');
      expect(meta.inversion).toBe(inversion);
    }
  });

  it('assigns stages and gates', () => {
    expect(STAGES).toHaveLength(5);
    expect(stageOf('interval.identify.m3').id).toBe('S1');
    expect(getStage('S1').gate.accuracy).toBe(0.9);
    expect(getStage('S2').skills).toEqual([]);
  });

  it('canonicalizes confusion pairs', () => {
    expect(confusionKey('M3', 'm3')).toBe('m3:M3');
    expect(confusionKey('p5', 'p4')).toBe('p4:p5');
    expect(confusionKey('min', 'maj')).toBe('maj:min');
  });

  it('rejects unknown skills', () => {
    expect(() => getSkill('interval.identify.unknown' as SkillId)).toThrow(RangeError);
  });
});

describe('priors', () => {
  it('builds a seed-free, M1-identify template key', () => {
    const key = templateKey(skill, features);
    expect(key).toContain('interval.identify.m3');
    expect(key).toContain('register=mid');
    expect(key).not.toContain('#');
    expect(templateKey(skill, { ...features, register: 'high' })).not.toBe(key);
  });

  it('does not put non-applicable features into the template', () => {
    const key = templateKey(skill, features);
    const rating = templateRating(skill, features);
    const other = { ...features, voices: 2 as const, bars: 5, chunk: 8 };
    expect(templateKey(skill, other)).toBe(key);
    expect(templateRating(skill, other)).toBe(rating);
  });

  it('adds applicable feature difficulty to the skill base', () => {
    const easy = templateRating(skill, { ...features, reference: 'tonic' });
    const hard = templateRating(skill, { ...features, reference: 'none' });
    expect(hard).toBeGreaterThan(easy);
    expect(templateRating('interval.identify.p8', features)).toBeLessThan(
      templateRating('interval.identify.m2', features),
    );
  });
});

describe('generate', () => {
  it('is reproducible from its own presented seed', () => {
    const first = generate(skill, features, 7, factory);
    const sameSeed = generate(skill, features, 7, factory);
    const repeat = generate(
      skill,
      features,
      first.presented.seed,
      factory,
    );
    const independent = generate(skill, features, 7, makeRngFactory());

    expect(sameSeed).toEqual(first);
    expect(repeat).toEqual(first);
    expect(independent).toEqual(first);
    expect(first.presented.seed).toBe(7);
  });

  it('keeps templateKey stable across seeds while changing the item', () => {
    const first = generate(skill, features, 7, factory);
    const otherSeed = generate(skill, features, 8, factory);
    expect(otherSeed.templateKey).toBe(first.templateKey);
    expect(otherSeed.presented.id).not.toBe(first.presented.id);
  });

  it('includes the template hash in id to avoid feature collisions', () => {
    const first = generate(skill, features, 7, factory);
    const otherFeatures = generate(skill, { ...features, register: 'high' }, 7, factory);
    expect(otherFeatures.presented.templateKey).not.toBe(first.presented.templateKey);
    expect(otherFeatures.presented.id).not.toBe(first.presented.id);
  });

  it('emits a non-empty stimulus and leaves score null', () => {
    const item = generate(skill, features, 11, factory);
    const index = choiceIndex(item);
    expect(item.presented.options?.[index]).toBe('m3');
    expect(item.presented.score).toBeNull();
    expect(stimulusOf(item).length).toBeGreaterThan(0);
  });

  it('changes stimulus with direction', () => {
    const asc = stimulusOf(generate(skill, { ...features, direction: 'asc' }, 7, factory));
    const desc = stimulusOf(generate(skill, { ...features, direction: 'desc' }, 7, factory));
    const harmonic = stimulusOf(
      generate(skill, { ...features, direction: 'harmonic' }, 7, factory),
    );

    expect(asc).not.toEqual(desc);
    expect(harmonic).toHaveLength(1);
    expect(harmonic[0]?.kind).toBe('chord');
  });

  it('changes stimulus with reference', () => {
    const none = stimulusOf(generate(skill, { ...features, reference: 'none' }, 7, factory));
    const tonic = stimulusOf(generate(skill, { ...features, reference: 'tonic' }, 7, factory));
    const chordRef = stimulusOf(
      generate(skill, { ...features, reference: 'chord' }, 7, factory),
    );

    expect(none).toHaveLength(2);
    expect(tonic).toHaveLength(3);
    expect(tonic[0]?.kind).toBe('note');
    expect(chordRef).toHaveLength(3);
    expect(chordRef[0]?.kind).toBe('chord');
  });

  it('changes stimulus with timbre, tempo, and register', () => {
    const piano = stimulusOf(generate(skill, { ...features, timbre: 'piano' }, 7, factory));
    const strings = stimulusOf(generate(skill, { ...features, timbre: 'strings' }, 7, factory));
    const slow = stimulusOf(
      generate(skill, { ...features, tempoBpm: 60 }, 7, factory),
    );
    const low = stimulusOf(generate(skill, { ...features, register: 'low' }, 7, factory));
    const high = stimulusOf(generate(skill, { ...features, register: 'high' }, 7, factory));

    expect(piano).not.toEqual(strings);
    expect(piano[0]?.kind === 'click' ? null : piano[0]?.timbre).toBe('piano');
    expect(strings[0]?.kind === 'click' ? null : strings[0]?.timbre).toBe('strings');
    expect(slow).not.toEqual(piano);

    const lowFirst = low[0];
    const highFirst = high[0];
    if (lowFirst?.kind !== 'note' || highFirst?.kind !== 'note') {
      throw new Error('expected note stimuli');
    }
    expect(lowFirst.midi).toBeLessThan(60);
    expect(highFirst.midi).toBeGreaterThanOrEqual(72);
  });

  it('arpeggiates or blocks a chord according to direction', () => {
    const ascending = stimulusOf(
      generate('chord.identify.min', { ...features, direction: 'asc' }, 13, factory),
    );
    const blocked = stimulusOf(
      generate('chord.identify.min', { ...features, direction: 'harmonic' }, 13, factory),
    );

    expect(ascending).toHaveLength(3);
    expect(ascending.every((event) => event.kind === 'note')).toBe(true);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.kind).toBe('chord');
  });

  it('deduplicates targets and keeps the skill', () => {
    const item = generate('interval.identify.p5', features, 12, factory);
    expect(item.targets).toContain('interval.identify.p5');
    expect(new Set(item.targets).size).toBe(item.targets.length);
    expect(item.presented.targets).toEqual(item.targets);
  });

  it('generates chord identification items', () => {
    const item = generate('chord.identify.min', features, 13, factory);
    expect(item.presented.prompt).toBe('识别和弦');
    expect(item.targets).toContain('chord.identify.min');
    expect([...(item.presented.options ?? [])].sort()).toEqual(['dim', 'maj', 'min']);
    expect(item.answerPitches).toHaveLength(3);
  });

  it('generates major and minor triad inversions without a third-inversion option', () => {
    for (const skill of ['chord.inversion.major.root', 'chord.inversion.major.first', 'chord.inversion.major.second', 'chord.inversion.minor.root', 'chord.inversion.minor.first', 'chord.inversion.minor.second'] as const) {
      const item = generate(skill, { ...features, direction: 'harmonic' }, 77, factory);
      expect(item.presented.options).toEqual(expect.arrayContaining(['root', 'first', 'second']));
      expect(item.presented.options).not.toContain('third');
      expect(item.presented.prompt).toBe('识别和弦转位');
      expect(item.answerPitches).toHaveLength(3);
      expect(item.presented.stimulus?.some((event) => event.kind === 'chord')).toBe(true);
      expect(item.presented.options?.[item.key.type === 'choice' ? item.key.index : -1]).toBe(skill.endsWith('.root') ? 'root' : skill.endsWith('.first') ? 'first' : 'second');
    }
  });

  it('reveals interval and chord pitches only outside PresentedItem', () => {
    const interval = generate('interval.identify.m3', features, 14, factory);
    const chord = generate('chord.identify.maj7', features, 14, factory);

    expect(interval.answerPitches).toHaveLength(2);
    expect(chord.answerPitches).toHaveLength(4);
    expect(interval.presented).not.toHaveProperty('answerPitches');
    expect(chord.presented).not.toHaveProperty('answerPitches');
  });

  it('rejects invalid features and seeds', () => {
    expect(() =>
      generate(skill, { ...features, tempoBpm: 0 }, 1, factory),
    ).toThrow(RangeError);
    expect(() =>
      generate(skill, { ...features, voices: 3 as 1 }, 1, factory),
    ).toThrow(RangeError);
    expect(() => generate(skill, features, -1, factory)).toThrow(RangeError);
    expect(() => generate(skill, features, 1.5, factory)).toThrow(RangeError);
  });
});
