import type { ExerciseSpec, Lesson } from '../ports';
import { scoreTimeline } from '../theory';
import { lessonForExercise, validateExerciseSpec } from './exercises';
import { skillsForPracticeSpec, validatePracticeSpec, type ChoicePracticeSpec, type SourceAddress } from './practice-specs';

export type ContentSpec = ChoicePracticeSpec | ExerciseSpec;

export interface ContentSource {
  readonly address: SourceAddress | null;
  readonly catalogTitle: string | null;
  readonly evidence: 'catalog-only' | 'parameters-verified' | 'local-design';
  readonly note: string;
}

export interface ContentLesson {
  readonly id: string;
  readonly order: number;
  readonly source: ContentSource;
  readonly spec: ContentSpec;
}

export interface ContentPack {
  readonly schemaVersion: 1;
  readonly packId: string;
  readonly revision: string;
  readonly title: string;
  readonly lessons: readonly ContentLesson[];
}

const DEFAULT_EXERCISE_RATING = 1100;
const DEFAULT_PERFORMANCE_POLICY = {
  grading: 'graded-v2', onsetMs: 100, durationMs: 150, pitchCents: 25, latencyMs: 0, alignStart: false,
} as const;

function hasFrameworkPolicy(value: unknown): boolean {
  if (!record(value)) return false;
  const policy = DEFAULT_PERFORMANCE_POLICY;
  return value.grading === policy.grading && value.onsetMs === policy.onsetMs &&
    value.durationMs === policy.durationMs && value.pitchCents === policy.pitchCents &&
    value.latencyMs === policy.latencyMs && value.alignStart === policy.alignStart &&
    Object.keys(value).length === Object.keys(policy).length;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new RangeError(`${path}: unsupported field ${unexpected}`);
}

function validateSource(value: unknown, path: string): asserts value is ContentSource {
  if (!record(value)) throw new RangeError(`${path}: expected source object`);
  assertKeys(value, ['address', 'catalogTitle', 'evidence', 'note'], path);
  if (!['catalog-only', 'parameters-verified', 'local-design'].includes(String(value.evidence)) || !text(value.note)) {
    throw new RangeError(`${path}: invalid evidence or note`);
  }
  if (value.address === null) {
    if (value.catalogTitle !== null || value.evidence !== 'local-design') throw new RangeError(`${path}: local design requires null address and catalog title`);
    return;
  }
  if (!record(value.address)) throw new RangeError(`${path}: invalid catalog address`);
  if (value.evidence === 'local-design') throw new RangeError(`${path}: local-design requires a null catalog address`);
  assertKeys(value.address, ['courseId', 'activity', 'module', 'lesson'], `${path}.address`);
  if (!text(value.address.courseId) ||
      !Number.isSafeInteger(value.address.activity) || Number(value.address.activity) < 0 ||
      !Number.isSafeInteger(value.address.module) || Number(value.address.module) < 1 ||
      !Number.isSafeInteger(value.address.lesson) || Number(value.address.lesson) < 1 ||
      !text(value.catalogTitle)) throw new RangeError(`${path}: invalid catalog address or title`);
}

function isChoiceSpec(value: Record<string, unknown>): boolean {
  return 'task' in value && 'stimulus' in value && 'scoring' in value;
}

function scoreFields(value: unknown): void {
  if (!record(value) || !Array.isArray(value.measures)) throw new RangeError('expected score object');
  assertKeys(value, ['clef', 'measures'], 'score');
  for (const measure of value.measures) {
    if (!record(measure) || !record(measure.key) || !record(measure.time) || !Array.isArray(measure.voices)) throw new RangeError('invalid measure object');
    assertKeys(measure, ['key', 'time', 'voices'], 'measure');
    assertKeys(measure.key, ['tonic', 'mode', 'fifths'], 'key');
    assertKeys(measure.time, ['beats', 'unit'], 'time');
    for (const voice of measure.voices) {
      if (!record(voice) || !Array.isArray(voice.notes)) throw new RangeError('invalid voice object');
      assertKeys(voice, ['notes'], 'voice');
      for (const note of voice.notes) {
        if (!record(note) || !record(note.duration)) throw new RangeError('invalid note object');
        assertKeys(note, ['pitch', 'duration', 'tie'], 'note');
        assertKeys(note.duration, ['value', 'dots', 'tuplet'], 'duration');
        if (note.duration.tuplet !== undefined) {
          if (!record(note.duration.tuplet)) throw new RangeError('invalid tuplet object');
          assertKeys(note.duration.tuplet, ['actual', 'normal'], 'tuplet');
        }
        if (note.pitch !== null) {
          if (!record(note.pitch)) throw new RangeError('invalid pitch object');
          assertKeys(note.pitch, ['midi', 'name'], 'pitch');
        }
      }
    }
  }
}

function validateContentSpec(value: unknown, path: string): asserts value is ContentSpec {
  if (!record(value)) throw new RangeError(`${path}: expected supported spec object`);
  try {
    if (isChoiceSpec(value)) {
      assertKeys(value, ['id', 'version', 'title', 'provenance', 'sourceTopic', 'task', 'stimulus', 'questionCount', 'scoring', 'availability'], path);
      if (!record(value.task) || !record(value.stimulus) || !record(value.sourceTopic)) throw new RangeError('invalid choice objects');
      const fields = value.task.kind === 'chord-inversion' ? ['qualities', 'inversions']
        : value.task.kind === 'scale-identification' ? ['modes']
        : value.task.kind === 'interval-comparison' ? ['semitones', 'commonTone', 'allowEqual']
          : value.task.kind === 'chord-identification' ? ['codes', 'voicing'] : ['codes'];
      assertKeys(value.task, ['kind', ...fields], `${path}.task`);
      assertKeys(value.stimulus, ['direction', 'rootMidi', 'tempoBpm', 'reference', 'gapBeats'], `${path}.stimulus`);
      assertKeys(value.sourceTopic, ['courseId', 'activity'], `${path}.sourceTopic`);
      validatePracticeSpec(value as unknown as ChoicePracticeSpec);
      if ((value as unknown as ChoicePracticeSpec).questionCount > 100) throw new RangeError('question count exceeds 100');
      return;
    }
    const kind = value.kind;
    const extra = kind === 'harmony-progression' ? ['tonics', 'mode', 'sequences', 'chordSequences']
      : kind === 'interval-singing' ? ['roots', 'intervals']
        : ['scores', 'generator', ...(kind === 'rhythm-correction' ? ['correctionShiftTicks'] : [])];
    assertKeys(value, ['id', 'version', 'kind', 'title', 'tempoBpm', 'itemRating', 'questionCount', 'policy', ...extra], path);
    validateExerciseSpec(value as unknown as ExerciseSpec);
    const spec = value as unknown as ExerciseSpec;
    if ('scores' in spec) for (const score of spec.scores) scoreFields(score);
    if (spec.kind === 'interval-singing') for (const interval of spec.intervals) assertKeys(interval, ['number', 'semitones', 'direction'], 'interval');
    if (spec.itemRating !== DEFAULT_EXERCISE_RATING || !hasFrameworkPolicy(spec.policy)) {
      throw new RangeError('difficulty and grading policy are framework-managed');
    }
    if (spec.tempoBpm < 40 || spec.tempoBpm > 200) throw new RangeError('tempo must be in 40..200 BPM');
    if ('scores' in spec && spec.scores.length > 0 && ['melody-singing', 'melody-imitation', 'rhythm-imitation', 'rhythm-reading'].includes(spec.kind)) {
      for (const score of spec.scores) {
        const timeline = scoreTimeline(score, spec.tempoBpm);
        if (timeline.notes.some((note) => note.dur < 90)) throw new RangeError('sung note duration is below the 90ms capture minimum');
      }
    }
  } catch (error) {
    throw new RangeError(`${path}: ${error instanceof Error ? error.message : 'invalid spec'}`);
  }
}

export function parseContentPack(value: unknown): ContentPack {
  if (!record(value) || value.schemaVersion !== 1 || !text(value.packId) || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value.packId) ||
      !text(value.revision) || !/^\d+\.\d+\.\d+$/.test(value.revision) || !text(value.title) ||
      !Array.isArray(value.lessons) || value.lessons.length < 1 || value.lessons.length > 100) {
    throw new RangeError('pack: invalid schemaVersion, identity, revision, title, or lesson count');
  }
  assertKeys(value, ['schemaVersion', 'packId', 'revision', 'title', 'lessons'], 'pack');
  const ids = new Set<string>();
  const orders = new Set<number>();
  const sources = new Set<string>();
  for (const [index, entry] of value.lessons.entries()) {
    const path = `lessons[${index}]`;
    if (!record(entry) || !text(entry.id) || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(entry.id) ||
        !Number.isSafeInteger(entry.order) || Number(entry.order) < 1) throw new RangeError(`${path}: invalid id or order`);
    assertKeys(entry, ['id', 'order', 'source', 'spec'], path);
    if (ids.has(entry.id)) throw new RangeError(`${path}.id: duplicate lesson id ${entry.id}`);
    if (orders.has(Number(entry.order))) throw new RangeError(`${path}.order: duplicate order ${entry.order}`);
    ids.add(entry.id);
    orders.add(Number(entry.order));
    validateSource(entry.source, `${path}.source`);
    if (entry.source.address) {
      const address = entry.source.address;
      const key = `${address.courseId}:a${address.activity}:m${address.module}:l${address.lesson}`;
      if (sources.has(key)) throw new RangeError(`${path}.source.address: duplicate source ${key}`);
      sources.add(key);
    }
    validateContentSpec(entry.spec, `${path}.spec`);
    if (entry.spec.id !== entry.id) throw new RangeError(`${path}.spec.id: must match lesson id`);
  }
  if (orders.size !== value.lessons.length || Array.from({ length: value.lessons.length }, (_, index) => index + 1).some((order) => !orders.has(order))) {
    throw new RangeError('pack.lessons: order must be contiguous from 1');
  }
  return value as unknown as ContentPack;
}

export function lessonForContent(entry: ContentLesson): Lesson {
  const spec = entry.spec;
  if ('kind' in spec) return lessonForExercise(spec);
  validatePracticeSpec(spec);
  if (spec.availability === 'planned') throw new RangeError('planned content cannot be previewed');
  const module = spec.task.kind === 'scale-identification' ? 'scale' : spec.task.kind.startsWith('interval-') ? 'interval' : 'chord';
  return { id: spec.id, title: spec.title, module, skills: skillsForPracticeSpec(spec),
    directions: [spec.stimulus.direction], source: 'custom', practiceSpec: spec };
}
