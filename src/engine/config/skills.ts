import type { ChoiceTask, ConfusionKey, ExerciseKind, PracticeDomain, Skill, SkillId, StageId } from '../ports';
import type { ChordQuality, ScaleMode } from '../theory';
import { EXTENDED_CHORDS, SCALE_INTERVALS, SCALE_LABELS } from '../theory';

export interface IntervalSkillMeta extends Skill {
  readonly domain: 'interval';
  readonly kind: 'interval';
  readonly code: string;
  readonly intervalNumber: number;
  readonly semitones: number;
  readonly options: readonly string[];
  readonly pairs: readonly ConfusionKey[];
}

export interface ChordSkillMeta extends Skill {
  readonly domain: 'chord';
  readonly kind: 'chord';
  readonly code: string;
  readonly quality: ChordQuality;
  readonly options: readonly string[];
  readonly pairs: readonly ConfusionKey[];
}

export interface ChordInversionSkillMeta extends Skill {
  readonly domain: 'chord';
  readonly kind: 'chord-inversion';
  readonly code: string;
  readonly quality: ChordQuality;
  readonly inversion: number;
  readonly options: readonly string[];
  readonly pairs: readonly ConfusionKey[];
}

export type TriadQuality = 'major' | 'minor';
export type TriadInversion = 0 | 1 | 2;
export type InversionQuality = Extract<ChoiceTask, { kind: 'chord-inversion' }>['qualities'][number];
export type ChordPosition = TriadInversion | 3;

export const TRIAD_INVERSION_QUALITIES: ReadonlySet<InversionQuality> = new Set([
  'major', 'minor', 'diminished', 'augmented', 'suspended4', 'majorFlat5', 'majorSharp5',
]);

export const INVERSION_QUALITY_LABELS: Readonly<Record<InversionQuality, string>> = {
  major: '大三和弦', minor: '小三和弦', diminished: '减三和弦',
  augmented: '增三和弦', suspended4: '挂四和弦', majorFlat5: '大三降五和弦', majorSharp5: '大三升五和弦',
  dominant7: '属七和弦', major7: '大七和弦', minor7: '小七和弦', halfDiminished7: '半减七和弦',
  minorMajor7: '小大七和弦', diminished7: '减七和弦', diminishedMajor7: '减大七和弦',
  dominant7Flat5: '属七降五和弦', dominant7Sharp5: '属七升五和弦',
  major7Flat5: '大七降五和弦', major7Sharp5: '大七升五和弦', dominant7sus4: '属七挂四和弦', major7sus4: '大七挂四和弦',
};

export interface ScaleSkillMeta extends Skill {
  readonly domain: 'scale';
  readonly kind: 'scale';
  readonly code: ScaleMode;
  readonly mode: ScaleMode;
  readonly options: readonly ScaleMode[];
  readonly pairs: readonly ConfusionKey[];
}

export interface ComparisonSkillMeta extends Skill {
  readonly domain: 'interval';
  readonly kind: 'interval-comparison';
  readonly code: 'a-larger' | 'b-larger' | 'equal';
  readonly options: readonly string[];
  readonly pairs: readonly ConfusionKey[];
}

export interface ExerciseSkillMeta extends Skill {
  readonly domain: PracticeDomain;
  readonly kind: 'exercise';
  readonly code: ExerciseKind;
  readonly options: readonly string[];
  readonly pairs: readonly ConfusionKey[];
}

export type SkillMeta = IntervalSkillMeta | ChordSkillMeta | ChordInversionSkillMeta | ScaleSkillMeta | ComparisonSkillMeta | ExerciseSkillMeta;

export const EXERCISE_DOMAINS: Readonly<Record<ExerciseKind, PracticeDomain>> = {
  'harmony-progression': 'function', 'rhythm-imitation': 'rhythm', 'rhythm-reading': 'rhythm',
  'rhythm-correction': 'rhythm', 'rhythm-dictation': 'dictation', 'melody-dictation': 'dictation',
  'interval-singing': 'sight', 'melody-singing': 'sight', 'melody-imitation': 'audiation',
};

export function exerciseSkillId(kind: ExerciseKind): SkillId {
  const domain = EXERCISE_DOMAINS[kind];
  if (!domain) throw new RangeError('unsupported exercise kind');
  return `${domain}.practice.${kind}`;
}

/** 混淆对按固定顺序归一，保证 "m3:M3" 与 "M3:m3" 不会变成两张卡。 */
export const CONFUSION_ORDER = [
  'm2',
  'M2',
  'm3',
  'M3',
  'p4',
  'tt',
  'p5',
  'm6',
  'M6',
  'm7',
  'M7',
  'p8',
  'm9',
  'M9',
  'm10',
  'M10',
  'maj',
  'min',
  'dim',
  'aug',
  'dom7',
  'min7',
  'maj7',
  'm7b5',
  'dim7',
  'min9',
  'dom9',
  '7b9',
  'maj79',
  'sus2',
  'sus4',
  '7sus4',
  'majb5',
  'maj#5',
  '7b5',
  '7#5',
  'maj6',
  'min6',
  'majadd9',
  'minadd9',
  'maj6b5',
  'maj6#5',
  'maj7b5',
  'maj7#5',
  'maj7sus4',
  'root',
  'first',
  'second',
  'third',
] as const;

const CONFUSION_INDEX = new Map<string, number>(
  CONFUSION_ORDER.map((code, index) => [code, index]),
);

export function confusionKey(a: string, b: string): ConfusionKey {
  const ia = CONFUSION_INDEX.get(a);
  const ib = CONFUSION_INDEX.get(b);
  if (ia !== undefined && ib !== undefined) {
    return ia <= ib ? `${a}:${b}` : `${b}:${a}`;
  }
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function intervalSkill(
  code: string,
  intervalNumber: number,
  semitones: number,
  label: string,
  options: readonly string[],
  pairs: readonly ConfusionKey[],
  stage: StageId = 'S1',
): IntervalSkillMeta {
  return {
    id: `interval.identify.${code}` as SkillId,
    domain: 'interval',
    stage,
    label,
    kind: 'interval',
    code,
    intervalNumber,
    semitones,
    options,
    pairs,
  };
}

function chordSkill(
  code: string,
  quality: ChordQuality,
  label: string,
  options: readonly string[],
  pairs: readonly ConfusionKey[],
): ChordSkillMeta {
  return {
    id: `chord.identify.${code}` as SkillId,
    domain: 'chord',
    stage: 'S1',
    label,
    kind: 'chord',
    code,
    quality,
    options,
    pairs,
  };
}

function chordInversionSkill(
  code: string,
  inversion: number,
  label: string,
  pairs: readonly ConfusionKey[],
  quality: ChordQuality = 'dominant7',
  options: readonly string[] = ['root', 'first', 'second', 'third'],
): ChordInversionSkillMeta {
  return {
    id: (quality === 'dominant7' ? `chord.inversion.${code}` : `chord.inversion.${quality}.${code}`) as SkillId,
    domain: 'chord',
    stage: 'S1',
    label,
    kind: 'chord-inversion',
    code,
    quality,
    inversion,
    options,
    pairs,
  };
}

const SECOND_PAIR = confusionKey('m2', 'M2');
const THIRD_PAIR = confusionKey('m3', 'M3');
const PERFECT_PAIR = confusionKey('p4', 'p5');
const OCTAVE_PAIR = confusionKey('p5', 'p8');
const TRITONE_PAIR = confusionKey('p4', 'tt');
const TRITONE_FIFTH_PAIR = confusionKey('tt', 'p5');
const SIXTH_PAIR = confusionKey('m6', 'M6');
const SEVENTH_PAIR = confusionKey('m7', 'M7');
const NINTH_PAIR = confusionKey('m9', 'M9');
const TENTH_PAIR = confusionKey('m10', 'M10');
const CHORD_PAIR = confusionKey('maj', 'min');
const DIM_PAIR = confusionKey('min', 'dim');
const AUG_PAIR = confusionKey('maj', 'aug');
const DOM_MIN7_PAIR = confusionKey('dom7', 'min7');
const MAJ7_DOM7_PAIR = confusionKey('maj7', 'dom7');
const M7B5_MIN7_PAIR = confusionKey('m7b5', 'min7');
const DIM7_M7B5_PAIR = confusionKey('dim7', 'm7b5');
const MIN9_DOM9_PAIR = confusionKey('min9', 'dom9');
const DOM7B9_MAJ79_PAIR = confusionKey('7b9', 'maj79');
const SUS_PAIR = confusionKey('sus2', 'sus4');
const SEVENTH_SUS_PAIR = confusionKey('7sus4', 'dom7');
const ALTERED_MAJOR_PAIR = confusionKey('majb5', 'maj#5');
const ALTERED_DOMINANT_PAIR = confusionKey('7b5', '7#5');
const CHORD_SIXTH_PAIR = confusionKey('maj6', 'min6');
const ADD9_PAIR = confusionKey('majadd9', 'minadd9');
const ALTERED_SIXTH_PAIR = confusionKey('maj6b5', 'maj6#5');
const ALTERED_MAJOR7_PAIR = confusionKey('maj7b5', 'maj7#5');
const SUS_MAJOR7_PAIR = confusionKey('maj7sus4', '7sus4');
const INVERSION_ROOT_FIRST = confusionKey('root', 'first');
const INVERSION_FIRST_SECOND = confusionKey('first', 'second');
const INVERSION_SECOND_THIRD = confusionKey('second', 'third');

export const SKILLS: readonly SkillMeta[] = [
  intervalSkill('m2', 2, 1, '小二度', ['m2', 'M2', 'm3', 'M3'], [SECOND_PAIR]),
  intervalSkill('M2', 2, 2, '大二度', ['m2', 'M2', 'm3', 'M3'], [SECOND_PAIR]),
  intervalSkill('m3', 3, 3, '小三度', ['m2', 'm3', 'M3', 'p4'], [THIRD_PAIR]),
  intervalSkill('M3', 3, 4, '大三度', ['m3', 'M3', 'p4', 'p5'], [THIRD_PAIR]),
  intervalSkill('p4', 4, 5, '纯四度', ['m3', 'M3', 'p4', 'p5'], [PERFECT_PAIR, TRITONE_PAIR]),
  intervalSkill('tt', 4, 6, '三全音', ['p4', 'tt', 'p5'], [TRITONE_PAIR, TRITONE_FIFTH_PAIR]),
  intervalSkill('p5', 5, 7, '纯五度', ['p4', 'p5', 'M3', 'p8'], [PERFECT_PAIR, OCTAVE_PAIR, TRITONE_FIFTH_PAIR]),
  intervalSkill('m6', 6, 8, '小六度', ['p5', 'm6', 'M6', 'p8'], [SIXTH_PAIR]),
  intervalSkill('M6', 6, 9, '大六度', ['p5', 'm6', 'M6', 'p8'], [SIXTH_PAIR]),
  intervalSkill('m7', 7, 10, '小七度', ['m6', 'm7', 'M7', 'p8'], [SEVENTH_PAIR]),
  intervalSkill('M7', 7, 11, '大七度', ['m6', 'm7', 'M7', 'p8'], [SEVENTH_PAIR]),
  intervalSkill('p8', 8, 12, '纯八度', ['p5', 'p8', 'p4', 'M3'], [OCTAVE_PAIR]),
  intervalSkill('m9', 9, 13, '小九度', ['p8', 'm9', 'M9', 'm10'], [NINTH_PAIR]),
  intervalSkill('M9', 9, 14, '大九度', ['p8', 'm9', 'M9', 'm10'], [NINTH_PAIR]),
  intervalSkill('m10', 10, 15, '小十度', ['m9', 'm10', 'M10', 'p8'], [TENTH_PAIR]),
  intervalSkill('M10', 10, 16, '大十度', ['m9', 'm10', 'M10', 'p8'], [TENTH_PAIR]),
  chordSkill('maj', 'major', '大三和弦', ['maj', 'min', 'dim'], [CHORD_PAIR]),
  chordSkill('min', 'minor', '小三和弦', ['maj', 'min', 'dim'], [CHORD_PAIR, DIM_PAIR]),
  chordSkill('dim', 'diminished', '减三和弦', ['maj', 'min', 'dim'], [DIM_PAIR]),
  chordSkill('aug', 'augmented', '增三和弦', ['maj', 'min', 'dim', 'aug'], [AUG_PAIR]),
  chordSkill('dom7', 'dominant7', '属七和弦', ['dom7', 'min7', 'maj7'], [DOM_MIN7_PAIR, MAJ7_DOM7_PAIR]),
  chordSkill('min7', 'minor7', '小七和弦', ['min7', 'dom7', 'm7b5'], [DOM_MIN7_PAIR, M7B5_MIN7_PAIR]),
  chordSkill('maj7', 'major7', '大七和弦', ['maj7', 'dom7', 'min7'], [MAJ7_DOM7_PAIR]),
  chordSkill('m7b5', 'halfDiminished7', '半减七和弦', ['m7b5', 'min7', 'dim7'], [M7B5_MIN7_PAIR, DIM7_M7B5_PAIR]),
  chordSkill('dim7', 'diminished7', '减七和弦', ['dim7', 'm7b5'], [DIM7_M7B5_PAIR]),
  chordSkill('min9', 'minor9', '小九和弦', ['min9', 'dom9', 'maj79'], [MIN9_DOM9_PAIR]),
  chordSkill('dom9', 'dominant9', '属九和弦', ['dom9', 'min9', '7b9'], [MIN9_DOM9_PAIR]),
  chordSkill('7b9', 'dominant7b9', '属七降九和弦', ['7b9', 'maj79', 'dom9'], [DOM7B9_MAJ79_PAIR]),
  chordSkill('maj79', 'major79', '大七加九和弦', ['maj79', '7b9', 'min9'], [DOM7B9_MAJ79_PAIR]),
  chordSkill('sus2', 'suspended2', '挂二和弦', ['sus2', 'sus4', 'maj'], [SUS_PAIR]),
  chordSkill('sus4', 'suspended4', '挂四和弦', ['sus4', 'sus2', 'maj'], [SUS_PAIR]),
  chordSkill('7sus4', 'dominant7sus4', '属七挂四和弦', ['7sus4', 'dom7', 'sus4'], [SEVENTH_SUS_PAIR]),
  chordSkill('majb5', 'majorFlat5', '大三降五和弦', ['majb5', 'maj#5', 'maj', 'dim'], [ALTERED_MAJOR_PAIR]),
  chordSkill('maj#5', 'majorSharp5', '大三升五和弦', ['maj#5', 'majb5', 'aug', 'maj'], [ALTERED_MAJOR_PAIR]),
  chordSkill('7b5', 'dominant7Flat5', '属七降五和弦', ['7b5', '7#5', 'dom7', 'm7b5'], [ALTERED_DOMINANT_PAIR]),
  chordSkill('7#5', 'dominant7Sharp5', '属七升五和弦', ['7#5', '7b5', 'dom7', 'aug'], [ALTERED_DOMINANT_PAIR]),
  chordSkill('maj6', 'major6', '大六和弦', ['maj', 'maj6', 'min6'], [CHORD_SIXTH_PAIR]),
  chordSkill('min6', 'minor6', '小六和弦', ['min', 'min6', 'maj6'], [CHORD_SIXTH_PAIR]),
  chordSkill('majadd9', 'majorAdd9', '大三加九和弦', ['maj', 'majadd9', 'minadd9'], [ADD9_PAIR]),
  chordSkill('minadd9', 'minorAdd9', '小三加九和弦', ['min', 'minadd9', 'majadd9'], [ADD9_PAIR]),
  chordSkill('maj6b5', 'major6Flat5', '大六降五和弦', ['maj6', 'maj6b5', 'maj6#5'], [ALTERED_SIXTH_PAIR]),
  chordSkill('maj6#5', 'major6Sharp5', '大六升五和弦', ['maj6', 'maj6b5', 'maj6#5'], [ALTERED_SIXTH_PAIR]),
  chordSkill('maj7b5', 'major7Flat5', '大七降五和弦', ['maj7', 'maj7b5', 'maj7#5'], [ALTERED_MAJOR7_PAIR]),
  chordSkill('maj7#5', 'major7Sharp5', '大七升五和弦', ['maj7', 'maj7b5', 'maj7#5'], [ALTERED_MAJOR7_PAIR]),
  chordSkill('maj7sus4', 'major7sus4', '大七挂四和弦', ['sus4', '7sus4', 'maj7sus4'], [SUS_MAJOR7_PAIR]),
  chordInversionSkill('root', 0, '原位', [INVERSION_ROOT_FIRST]),
  chordInversionSkill('first', 1, '第一转位', [INVERSION_ROOT_FIRST, INVERSION_FIRST_SECOND]),
  chordInversionSkill('second', 2, '第二转位', [INVERSION_FIRST_SECOND, INVERSION_SECOND_THIRD]),
  chordInversionSkill('third', 3, '第三转位', [INVERSION_SECOND_THIRD]),
];

export const EXTENDED_CHORD_SKILLS: readonly ChordSkillMeta[] = Object.entries(EXTENDED_CHORDS).map(([quality, definition]) =>
  chordSkill(definition.code, quality as ChordQuality, definition.label,
    [definition.code, 'dom7', 'maj7', 'min7'], [confusionKey(definition.code, 'dom7')]));

export const COURSE_SKILLS: readonly SkillMeta[] = [
  chordInversionSkill('root', 0, '大三和弦原位', [INVERSION_ROOT_FIRST], 'major', ['root', 'first', 'second']),
  chordInversionSkill('first', 1, '大三和弦第一转位', [INVERSION_ROOT_FIRST, INVERSION_FIRST_SECOND], 'major', ['root', 'first', 'second']),
  chordInversionSkill('second', 2, '大三和弦第二转位', [INVERSION_FIRST_SECOND], 'major', ['root', 'first', 'second']),
  chordInversionSkill('root', 0, '小三和弦原位', [INVERSION_ROOT_FIRST], 'minor', ['root', 'first', 'second']),
  chordInversionSkill('first', 1, '小三和弦第一转位', [INVERSION_ROOT_FIRST, INVERSION_FIRST_SECOND], 'minor', ['root', 'first', 'second']),
  chordInversionSkill('second', 2, '小三和弦第二转位', [INVERSION_FIRST_SECOND], 'minor', ['root', 'first', 'second']),
];

export const EXTENDED_INVERSION_SKILLS: readonly ChordInversionSkillMeta[] =
  (['augmented', 'suspended4', 'majorFlat5', 'majorSharp5', 'diminished', 'diminished7', 'diminishedMajor7', 'dominant7', 'major7', 'minor7', 'halfDiminished7', 'minorMajor7', 'dominant7Flat5', 'dominant7Sharp5', 'major7Flat5', 'major7Sharp5', 'dominant7sus4', 'major7sus4'] as const).flatMap((quality) => {
    const positions = TRIAD_INVERSION_QUALITIES.has(quality) ? [0, 1, 2] as const : [0, 1, 2, 3] as const;
    const codes = positions.map((position) => ['root', 'first', 'second', 'third'][position]!);
    return positions.map((position) => ({
      ...chordInversionSkill(codes[position]!, position,
        `${INVERSION_QUALITY_LABELS[quality]} · ${['原位', '第一转位', '第二转位', '第三转位'][position]}`,
        [], quality, codes),
      id: `chord.inversion.${quality}.${codes[position]}` as SkillId,
    }));
  });

const SCALE_MODES = Object.keys(SCALE_INTERVALS) as ScaleMode[];

export const SCALE_SKILLS: readonly ScaleSkillMeta[] = SCALE_MODES.map((mode) => ({
  id: `scale.identify.${mode}`,
  domain: 'scale', stage: 'S1', kind: 'scale', code: mode, mode,
  label: SCALE_LABELS[mode],
  options: SCALE_MODES, pairs: [],
}));

export const COMPARISON_SKILLS: readonly ComparisonSkillMeta[] = (['a-larger', 'b-larger', 'equal'] as const).map((code) => ({
  id: `interval.compare.common-first.${code}`, domain: 'interval', stage: 'S1', kind: 'interval-comparison', code,
  label: { 'a-larger': 'A 更大', 'b-larger': 'B 更大', equal: '相同' }[code],
  options: ['a-larger', 'b-larger', 'equal'], pairs: [],
}));

export const EXERCISE_SKILLS: readonly ExerciseSkillMeta[] = (Object.keys(EXERCISE_DOMAINS) as ExerciseKind[]).map((kind) => ({
  id: exerciseSkillId(kind), domain: EXERCISE_DOMAINS[kind], stage: 'S1', label: kind,
  kind: 'exercise', code: kind, options: [], pairs: [],
}));

export const SKILL_BY_ID: ReadonlyMap<SkillId, SkillMeta> = new Map(
  [...SKILLS, ...COURSE_SKILLS, ...EXTENDED_CHORD_SKILLS, ...EXTENDED_INVERSION_SKILLS, ...SCALE_SKILLS, ...COMPARISON_SKILLS, ...EXERCISE_SKILLS].map((skill) => [skill.id, skill]),
);

export function getSkill(id: SkillId): SkillMeta {
  const skill = SKILL_BY_ID.get(id);
  if (skill === undefined) {
    throw new RangeError(`unknown skill ${id}`);
  }
  return skill;
}

export function chordInversionSkillId(
  quality: InversionQuality,
  inversion: ChordPosition,
): SkillId {
  const code = (['root', 'first', 'second', 'third'] as const)[inversion];
  if (!Object.hasOwn(INVERSION_QUALITY_LABELS, quality) || code === undefined ||
      (TRIAD_INVERSION_QUALITIES.has(quality) && inversion === 3)) {
    throw new RangeError(`invalid chord inversion ${quality}/${inversion}`);
  }
  return `chord.inversion.${quality}.${code}`;
}
