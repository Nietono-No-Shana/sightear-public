import type { ItemFeatures, SkillId } from '../ports';
import { getSkill } from './skills';

const REGISTERS = ['low', 'mid', 'high'] as const;
const DIRECTIONS = ['asc', 'desc', 'harmonic'] as const;
const REFERENCES = ['none', 'tonic', 'chord'] as const;
const TIMBRES = ['piano', 'strings', 'synth', 'organ'] as const;

const BASE_BY_CODE: Readonly<Record<string, number>> = {
  'a-larger': 950,
  'b-larger': 950,
  equal: 1000,
  major: 1000,
  naturalMinor: 1050,
  harmonicMinor: 1100,
  dorian: 1050,
  phrygian: 1100,
  lydian: 1100,
  mixolydian: 1050,
  locrian: 1150,
  melodicMinor: 1150,
  dorianFlat2: 1250,
  lydianAugmented: 1250,
  lydianDominant: 1200,
  mixolydianFlat6: 1250,
  locrianSharp2: 1250,
  altered: 1300,
  locrianSharp6: 1300,
  ionianSharp5: 1300,
  dorianSharp4: 1300,
  phrygianDominant: 1250,
  lydianSharp2: 1300,
  ultralocrian: 1350,
  wholeTone: 1150,
  diminishedWholeHalf: 1300,
  diminishedHalfWhole: 1300,
  pentatonicMajor: 1100,
  pentatonicMinor: 1100,
  m2: 1150,
  M2: 1100,
  m3: 1050,
  M3: 1000,
  p4: 950,
  tt: 1200,
  p5: 900,
  m6: 1000,
  M6: 950,
  m7: 1050,
  M7: 1100,
  p8: 850,
  m9: 1100,
  M9: 1050,
  m10: 1150,
  M10: 1100,
  maj: 1000,
  min: 1050,
  dim: 1150,
  aug: 1150,
  dom7: 1050,
  min7: 1100,
  maj7: 1150,
  m7b5: 1200,
  dim7: 1250,
  min9: 1200,
  dom9: 1150,
  '7b9': 1300,
  maj79: 1250,
  sus2: 1000,
  sus4: 1050,
  '7sus4': 1200,
  majb5: 1200,
  'maj#5': 1200,
  '7b5': 1250,
  '7#5': 1250,
  maj6: 1050,
  min6: 1100,
  majadd9: 1150,
  minadd9: 1200,
  'maj6b5': 1250,
  'maj6#5': 1250,
  'maj7b5': 1250,
  'maj7#5': 1250,
  maj7sus4: 1200,
  minmaj7: 1250,
  dimmaj7: 1300,
  minmaj9: 1350,
  '7#9': 1300,
  dom11: 1350,
  min11: 1300,
  maj11: 1400,
  dom13: 1400,
  min13: 1400,
  maj13: 1450,
  'dom9#11': 1400,
  'maj9#11': 1450,
  maj69: 1250,
  min69: 1300,
  root: 1000,
  first: 1050,
  second: 1100,
  third: 1150,
};

const REGISTER_BETA: Readonly<Record<(typeof REGISTERS)[number], number>> = {
  low: -20,
  mid: 0,
  high: 20,
};

const DIRECTION_BETA: Readonly<Record<(typeof DIRECTIONS)[number], number>> = {
  asc: 0,
  desc: 0,
  harmonic: 30,
};

const REFERENCE_BETA: Readonly<Record<(typeof REFERENCES)[number], number>> = {
  none: 60,
  tonic: 0,
  chord: -20,
};

const TIMBRE_BETA: Readonly<Record<(typeof TIMBRES)[number], number>> = {
  piano: 0,
  strings: 15,
  synth: 20,
  organ: 10,
};

export function assertItemFeatures(features: ItemFeatures): void {
  if (!REGISTERS.includes(features.register)) {
    throw new RangeError(`invalid register ${String(features.register)}`);
  }
  if (!DIRECTIONS.includes(features.direction)) {
    throw new RangeError(`invalid direction ${String(features.direction)}`);
  }
  if (!REFERENCES.includes(features.reference)) {
    throw new RangeError(`invalid reference ${String(features.reference)}`);
  }
  if (!TIMBRES.includes(features.timbre)) {
    throw new RangeError(`invalid timbre ${String(features.timbre)}`);
  }
  if (!Number.isFinite(features.tempoBpm) || features.tempoBpm <= 0 || features.tempoBpm > 400) {
    throw new RangeError(`invalid tempoBpm ${features.tempoBpm}`);
  }
  if (features.voices !== 1 && features.voices !== 2 && features.voices !== 4) {
    throw new RangeError(`invalid voices ${features.voices}`);
  }
  if (!Number.isInteger(features.bars) || features.bars < 1 || features.bars > 64) {
    throw new RangeError(`invalid bars ${features.bars}`);
  }
  if (!Number.isInteger(features.chunk) || features.chunk < 1 || features.chunk > 16) {
    throw new RangeError(`invalid chunk ${features.chunk}`);
  }
}

export function baseDifficulty(skill: SkillId): number {
  const code = getSkill(skill).code;
  const base = BASE_BY_CODE[code];
  if (base === undefined) {
    throw new RangeError(`missing base difficulty for ${skill}`);
  }
  return base;
}

/** templateKey 只由 skill + 影响难度的 features 决定；seed 不进来。 */
export function templateKey(skill: SkillId, features: ItemFeatures): string {
  getSkill(skill);
  assertItemFeatures(features);
  return [
    skill,
    `register=${features.register}`,
    `direction=${features.direction}`,
    `reference=${features.reference}`,
    `timbre=${features.timbre}`,
    `tempo=${features.tempoBpm}`,
  ].join('|');
}

/** b(template) = base[skill] + Σβ_feature；M1 只读，不更新。 */
export function templateRating(skill: SkillId, features: ItemFeatures): number {
  const base = baseDifficulty(skill);
  assertItemFeatures(features);
  return Math.round(
    base +
      REGISTER_BETA[features.register] +
      DIRECTION_BETA[features.direction] +
      REFERENCE_BETA[features.reference] +
      TIMBRE_BETA[features.timbre] +
      (features.tempoBpm - 120) * 0.5,
  );
}
