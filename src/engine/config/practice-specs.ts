import type { ChoiceTask, ChoicePracticeSpec, Course, Lesson, SkillId } from '../ports';
export type { ChoiceTask, ChoicePracticeSpec } from '../ports';
import { chordInversionSkillId, getSkill, INVERSION_QUALITY_LABELS, TRIAD_INVERSION_QUALITIES, type InversionQuality, type ChordPosition } from './skills';
import { buildChord, voiceChord, parsePitchName, SCALE_INTERVALS } from '../theory';

export interface SourceAddress {
  readonly courseId: string;
  readonly activity: number;
  readonly module: number;
  readonly lesson: number;
}

export interface SourceReview {
  readonly address: SourceAddress;
  readonly catalogLessonId: string;
  readonly title: string;
  readonly disposition: 'excluded' | 'pending';
  readonly reason: string;
}


export function sourceAddressKey(address: SourceAddress): string {
  if (!address.courseId.trim()) throw new RangeError('missing source course');
  for (const [name, value] of Object.entries({ activity: address.activity, module: address.module, lesson: address.lesson })) {
    if (!Number.isSafeInteger(value) || value < (name === 'activity' ? 0 : 1)) {
      throw new RangeError(`invalid source ${name}`);
    }
  }
  return `${address.courseId}:a${address.activity}:m${address.module}:l${address.lesson}`;
}

const EXCLUSIONS: Readonly<Record<string, string>> = {
  'catalog:ET101:a0:m1:l1': '课程介绍，不作为练习。',
  'catalog:ET101:a0:m22:l14': '课程结束页，不作为练习。',
  'catalog:Std:a3:m1:l1': '纯音程介绍，排除教学入口。',
  'catalog:Std:a3:m2:l1': '不完全协和音程介绍，排除教学入口。',
  'catalog:Std:a3:m3:l1': '不协和音程介绍，排除教学入口。',
  'catalog:Std:a3:m5:l1': '复音程介绍，排除教学入口。',
};

export function buildSourceReview(courses: readonly Course[]): readonly SourceReview[] {
  const entries: SourceReview[] = [];
  const seen = new Set<string>();
  for (const course of courses) {
    if (course.id !== 'catalog:ET101' && course.id !== 'catalog:Std') continue;
    for (const module of course.modules) {
      const location = module.sourceLocation;
      if (!location) throw new RangeError(`missing source location: ${module.id}`);
      if (course.id === 'catalog:Std' && ![3, 7, 8].includes(location.activityNumber)) continue;
      for (const lesson of module.lessons) {
        const source = lesson.sourceLocation;
        if (!source || source.lessonNumber === undefined || source.activityNumber !== location.activityNumber || source.moduleNumber !== location.moduleNumber) {
          throw new RangeError(`invalid lesson location: ${lesson.id}`);
        }
        const address = { courseId: course.id, activity: source.activityNumber, module: source.moduleNumber, lesson: source.lessonNumber };
        const key = sourceAddressKey(address);
        if (seen.has(key)) throw new RangeError(`duplicate source address: ${key}`);
        seen.add(key);
        const exclusion = EXCLUSIONS[key];
        entries.push({ address, catalogLessonId: lesson.id, title: lesson.title,
          disposition: exclusion === undefined ? 'pending' : 'excluded',
          reason: exclusion ?? '仅确认目录位置；任务、参数及是否合并尚待核实。' });
      }
    }
  }
  return entries;
}

export function practiceAnswerCodes(task: ChoiceTask): readonly string[] {
  switch (task.kind) {
    case 'interval-identification':
    case 'chord-identification': return task.codes;
    case 'chord-inversion': return task.inversions.map((inversion) => ['root', 'first', 'second', 'third'][inversion] ?? '');
    case 'scale-identification': return task.modes;
    case 'interval-comparison': return task.allowEqual ? ['a-larger', 'b-larger', 'equal'] : ['a-larger', 'b-larger'];
    default: throw new RangeError('unsupported practice task');
  }
}

export function inversionSkillsForSpec(spec: ChoicePracticeSpec): readonly ReturnType<typeof chordInversionSkillId>[] {
  validatePracticeSpec(spec);
  const task = spec.task;
  if (task.kind !== 'chord-inversion') throw new RangeError('spec is not a chord inversion lesson');
  return task.qualities.flatMap((quality) => task.inversions.map((inversion) => {
    const skill = chordInversionSkillId(quality, inversion);
    const meta = getSkill(skill);
    if (meta.kind !== 'chord-inversion' || meta.quality !== quality || meta.inversion !== inversion) {
      throw new RangeError(`inconsistent inversion skill ${skill}`);
    }
    return skill;
  }));
}

export function skillsForPracticeSpec(spec: ChoicePracticeSpec): readonly SkillId[] {
  validatePracticeSpec(spec);
  if (spec.task.kind === 'interval-identification' || spec.task.kind === 'chord-identification') {
    const domain = spec.task.kind === 'interval-identification' ? 'interval' : 'chord';
    return spec.task.codes.map((code): SkillId => `${domain}.identify.${code}`);
  }
  if (spec.task.kind === 'chord-inversion') return inversionSkillsForSpec(spec);
  if (spec.task.kind === 'interval-comparison') {
    return practiceAnswerCodes(spec.task).map((code) => {
      const skill: SkillId = `interval.compare.common-first.${code}`;
      if (getSkill(skill).kind !== 'interval-comparison') throw new RangeError('inconsistent comparison skill');
      return skill;
    });
  }
  if (spec.task.kind !== 'scale-identification') throw new RangeError('unsupported choice task');
  return spec.task.modes.map((mode) => {
    const skill: SkillId = `scale.identify.${mode}`;
    const meta = getSkill(skill);
    if (meta.kind !== 'scale' || meta.mode !== mode) throw new RangeError('inconsistent scale skill');
    return skill;
  });
}

export function practiceSpecForLesson(lesson: Lesson | undefined): ChoicePracticeSpec | undefined {
  if (!lesson || (lesson.practiceSpecId === undefined && lesson.practiceSpec === undefined)) return undefined;
  if (lesson.exerciseSpec || (lesson.practiceSpecId && lesson.practiceSpec)) throw new RangeError('ambiguous lesson spec');
  const spec = lesson.practiceSpec ?? ALL_PRACTICE_SPECS.find((entry) => entry.id === lesson.practiceSpecId);
  if (!spec || spec.availability === 'planned') throw new RangeError('practice spec is not playable');
  const skills = skillsForPracticeSpec(spec);
  const domain = spec.task.kind === 'scale-identification' ? 'scale' : spec.task.kind.startsWith('interval-') ? 'interval' : 'chord';
  if (lesson.id !== spec.id || lesson.module !== domain ||
      lesson.directions.length !== 1 || lesson.directions[0] !== spec.stimulus.direction ||
      lesson.skills.length !== skills.length || !skills.every((skill) => lesson.skills.includes(skill))) {
    throw new RangeError('lesson does not match practice spec');
  }
  return spec;
}

/** 这些和弦的转位音程结构完全相同，只有给出主音参考时才能判断低音。 */
const SYMMETRIC_INVERSION_QUALITIES: ReadonlySet<InversionQuality> = new Set([
  'augmented', 'majorSharp5', 'diminished7', 'dominant7Flat5',
]);

export function validatePracticeSpec(spec: ChoicePracticeSpec): void {
  if (!spec.id.trim() || !spec.title.trim() || spec.version !== 1) throw new RangeError('invalid spec identity');
  if (spec.provenance !== 'local-design' || !['planned', 'engine-ready', 'playable'].includes(spec.availability) || spec.scoring !== 'exact-choice-v1') throw new RangeError('invalid spec status');
  if (!Number.isSafeInteger(spec.questionCount) || spec.questionCount < 1) throw new RangeError('invalid question count');
  const { rootMidi, tempoBpm, gapBeats, reference, direction } = spec.stimulus;
  if (rootMidi.length !== 2 || !rootMidi.every(Number.isInteger) || rootMidi[0] < 0 || rootMidi[1] > 127 || rootMidi[0] > rootMidi[1]) throw new RangeError('invalid root range');
  if (!Number.isFinite(tempoBpm) || tempoBpm <= 0 || tempoBpm > 400 || !Number.isFinite(gapBeats) || gapBeats < 0 || !['none', 'tonic', 'chord'].includes(reference)) throw new RangeError('invalid stimulus');
  const task = spec.task;
  const activity = task.kind === 'chord-inversion' ? 7 : task.kind === 'scale-identification' ? 8
    : task.kind === 'chord-identification' ? 1 : task.kind === 'interval-identification' ? 2 : 3;
  if (!spec.sourceTopic.courseId.trim() || spec.sourceTopic.activity !== activity) throw new RangeError('invalid source topic');
  const answers = practiceAnswerCodes(task);
  if (answers.length < 2 || answers.some((answer) => !answer) || new Set(answers).size !== answers.length) throw new RangeError('invalid answers');
  let span = 12;
  if (task.kind === 'interval-identification' || task.kind === 'chord-identification') {
    if (!['asc', 'desc', 'harmonic'].includes(direction)) throw new RangeError('invalid identification direction');
    const domain = task.kind === 'interval-identification' ? 'interval' : 'chord';
    const spans = task.codes.map((code) => {
      const meta = getSkill(`${domain}.identify.${code}`);
      if (meta.kind === 'interval' && domain === 'interval') return meta.semitones;
      if (meta.kind === 'chord' && task.kind === 'chord-identification') return Math.max(...voiceChord(parsePitchName('C4')!, meta.quality, task.voicing).map((tone) => tone.midi - 60));
      throw new RangeError('unsupported identification code');
    });
    span = Math.max(...spans);
    if (task.kind === 'chord-identification') {
      const signatures = task.codes.map((code) => {
        const meta = getSkill(`chord.identify.${code}`);
        if (meta.kind !== 'chord') throw new RangeError('invalid chord skill');
        return voiceChord(parsePitchName('C4')!, meta.quality, task.voicing).map((tone) => tone.midi).join(',');
      });
      if (new Set(signatures).size !== signatures.length) throw new RangeError('ambiguous chord answers after voicing');
    }
  } else if (task.kind === 'chord-inversion') {
    if (!task.qualities.length || new Set(task.qualities).size !== task.qualities.length || task.qualities.some((quality) => !Object.hasOwn(INVERSION_QUALITY_LABELS, quality))) throw new RangeError('invalid chord qualities');
    if (task.inversions.some((inversion) => ![0, 1, 2, 3].includes(inversion)) || !['asc', 'desc', 'harmonic'].includes(direction) ||
        (task.inversions.includes(3) && task.qualities.some((quality) => TRIAD_INVERSION_QUALITIES.has(quality)))) throw new RangeError('invalid inversions');
    const root = parsePitchName('C4')!;
    span = Math.max(...task.qualities.flatMap((quality) => task.inversions.flatMap((inversion) =>
      buildChord(root, quality, inversion).map((tone) => tone.midi - root.midi))));
    for (const quality of task.qualities) {
      if (reference === 'tonic' && SYMMETRIC_INVERSION_QUALITIES.has(quality)) continue;
      const signatures = task.inversions.map((inversion) => {
        const tones = buildChord(root, quality, inversion);
        return tones.map((tone) => tone.midi - tones[0]!.midi).join(',');
      });
      if (new Set(signatures).size !== signatures.length) throw new RangeError('ambiguous chord inversions');
    }
  } else if (task.kind === 'scale-identification') {
    if (task.modes.some((mode) => !Object.hasOwn(SCALE_INTERVALS, mode)) || !['asc', 'desc'].includes(direction)) throw new RangeError('invalid scale modes');
  } else {
    if (task.semitones.length < 2 || new Set(task.semitones).size !== task.semitones.length || task.semitones.some((value) => !Number.isInteger(value) || value < 1 || value > 24)) throw new RangeError('invalid intervals');
    if (task.commonTone !== 'first' || typeof task.allowEqual !== 'boolean' || direction !== 'asc' || gapBeats <= 0) throw new RangeError('invalid comparison stimulus');
    span = Math.max(...task.semitones);
  }
  if (rootMidi[1] + span > 127) throw new RangeError('stimulus exceeds MIDI range');
}

function localSpec(id: string, title: string, task: ChoiceTask): ChoicePracticeSpec {
  const spec: ChoicePracticeSpec = {
    id: `practice:${id}`, title, task, version: 1, provenance: 'local-design',
    sourceTopic: { courseId: 'catalog:Std', activity: task.kind === 'chord-inversion' ? 7 : task.kind === 'scale-identification' ? 8 : task.kind === 'chord-identification' ? 1 : task.kind === 'interval-identification' ? 2 : 3 },
    stimulus: { direction: task.kind === 'chord-inversion' ? 'harmonic' : 'asc', rootMidi: [48, 59], tempoBpm: 90, reference: 'none', gapBeats: task.kind === 'interval-comparison' ? 2 : 0 },
    questionCount: 12, scoring: 'exact-choice-v1',
    availability: task.kind === 'chord-inversion' ? 'playable' : 'engine-ready',
  };
  validatePracticeSpec(spec);
  return spec;
}

export const INITIAL_PRACTICE_SPECS: readonly ChoicePracticeSpec[] = [
  ...(['major', 'minor'] as const).flatMap((quality) =>
    ([[0, 1], [0, 2], [0, 1, 2]] as const).map((inversions) => localSpec(
      `inversion:${quality}:${inversions.join('-')}`, `${quality === 'major' ? '大' : '小'}三和弦 · ${inversions.join('/')}`,
      { kind: 'chord-inversion', qualities: [quality], inversions },
    )),
  ),
  localSpec('inversion:mixed:0-1-2', '大小三和弦 · 转位混合', { kind: 'chord-inversion', qualities: ['major', 'minor'], inversions: [0, 1, 2] }),
  localSpec('scale:major-natural', '大调 / 自然小调', { kind: 'scale-identification', modes: ['major', 'naturalMinor'] }),
  localSpec('scale:minor-variants', '自然小调 / 和声小调', { kind: 'scale-identification', modes: ['naturalMinor', 'harmonicMinor'] }),
  localSpec('scale:three-modes', '三种音阶混合', { kind: 'scale-identification', modes: ['major', 'naturalMinor', 'harmonicMinor'] }),
  localSpec('comparison:perfect-common-first', '纯音程比较 · 共同起音', { kind: 'interval-comparison', semitones: [5, 7, 12], commonTone: 'first', allowEqual: false }),
];

export const EXTENDED_INVERSION_SPECS: readonly ChoicePracticeSpec[] = [
  ...(['diminished', 'dominant7', 'major7', 'minor7', 'halfDiminished7'] as const).flatMap((quality) => {
    const sets: readonly (readonly ChordPosition[])[] = quality === 'diminished'
      ? [[0, 1], [0, 2], [0, 1, 2]]
      : [[0, 1], [0, 2], [0, 3], [0, 1, 2, 3]];
    return sets.map((inversions) => localSpec(
      `inversion:${quality}:${inversions.join('-')}`,
      `${INVERSION_QUALITY_LABELS[quality]} · ${inversions.join('/')}`,
      { kind: 'chord-inversion', qualities: [quality], inversions },
    ));
  }),
  localSpec('inversion:sevenths:0-1-2-3', '四类七和弦 · 转位混合', {
    kind: 'chord-inversion', qualities: ['dominant7', 'major7', 'minor7', 'halfDiminished7'], inversions: [0, 1, 2, 3],
  }),
];

export const ALL_PRACTICE_SPECS: readonly ChoicePracticeSpec[] = [...INITIAL_PRACTICE_SPECS, ...EXTENDED_INVERSION_SPECS];
