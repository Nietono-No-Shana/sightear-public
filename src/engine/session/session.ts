import type {
  Attempt,
  BlockKind,
  Clock,
  ConfusionKey,
  DerivedSnapshot,
  Judgement,
  Lesson,
  Millis,
  PracticeRequest,
  PracticeScope,
  Rng,
  RngFactory,
  ScheduleKey,
  SessionBlock,
  SessionPlan,
  SkillId,
  StageId,
  TimbreId,
  TrainingFocus,
} from '../ports';
import { replay as replayAbility } from '../ability';
import { due as dueEntries, replay as replaySchedule } from '../schedule';
import { getSkill, SKILLS, practiceSpecForLesson, lessonForExercise, type SkillMeta } from '../config';
import { next as selectNext, TARGET_P, type NextItem } from '../selection';

const DAILY_MS = 25 * 60 * 1000;
const FOCUS_MS = 10 * 60 * 1000;
const STAGE: StageId = 'S1';
const TIMBRES: readonly TimbreId[] = ['piano', 'strings', 'synth', 'organ'];

const DAILY_LAYOUT: readonly { kind: BlockKind; weight: number }[] = [
  { kind: 'warmup', weight: 0.1 },
  { kind: 'review', weight: 0.15 },
  { kind: 'core', weight: 0.2 },
  { kind: 'core', weight: 0.2 },
  { kind: 'core', weight: 0.15 },
  { kind: 'review', weight: 0.2 },
];

export interface SessionState {
  readonly request: PracticeRequest;
  readonly plan: SessionPlan;
  readonly attempts: readonly Attempt[];
  readonly snapshot: DerivedSnapshot;
  readonly itemsCompleted: number;
}

function scopeSkills(scope: PracticeScope): readonly SkillMeta[] {
  return SKILLS.filter(
    (skill) => skill.stage === STAGE && (scope === 'mixed' || skill.domain === scope),
  );
}

function hasDueInScope(
  snapshot: DerivedSnapshot,
  scope: PracticeScope,
  now: Millis,
): boolean {
  const skills = scopeSkills(scope);
  const ids = new Set<SkillId>(skills.map((skill) => skill.id));

  for (const entry of dueEntries(snapshot.schedule, now)) {
    if (ids.has(entry.key as SkillId)) return true;
    if (skills.some((skill) => skill.pairs.includes(entry.key as ConfusionKey))) {
      return true;
    }
  }
  return false;
}

function hasNewInScope(snapshot: DerivedSnapshot, scope: PracticeScope): boolean {
  const practiced = new Map(snapshot.ability.map((state) => [state.skill, state.n]));
  return scopeSkills(scope).some((skill) => (practiced.get(skill.id) ?? 0) === 0);
}

function dailyFocus(
  scope: PracticeScope,
  snapshot: DerivedSnapshot,
  now: Millis,
): TrainingFocus {
  if (hasDueInScope(snapshot, scope, now)) {
    return { kind: 'due', reason: '到期复习' };
  }
  if (hasNewInScope(snapshot, scope)) {
    return { kind: 'new', reason: '新内容' };
  }
  return { kind: 'mixed', reason: '混合复习' };
}

function validateFocus(
  focus: TrainingFocus | undefined,
  scope: PracticeScope,
): TrainingFocus {
  if (focus === undefined) {
    throw new RangeError('focus mode requires request.focus');
  }
  if (focus.kind !== 'pair' && focus.kind !== 'skill') {
    throw new RangeError('focus mode focus.kind must be pair or skill');
  }

  if (focus.kind === 'pair') {
    const pair = focus.pair;
    if (pair === undefined) {
      throw new RangeError('pair focus requires focus.pair');
    }
    const matched = scopeSkills(scope).filter((skill) => skill.pairs.includes(pair));
    if (matched.length === 0) {
      throw new RangeError(`pair ${pair} is outside scope ${scope}`);
    }
    return { kind: 'pair', pair, reason: focus.reason.trim() || `专项：${pair}` };
  }

  const skillId = focus.skill;
  if (skillId === undefined) {
    throw new RangeError('skill focus requires focus.skill');
  }
  const matched = scopeSkills(scope).find((skill) => skill.id === skillId);
  if (matched === undefined) {
    throw new RangeError(`skill ${skillId} is outside scope ${scope}`);
  }
  return { kind: 'skill', skill: skillId, reason: focus.reason.trim() || `专项：${matched.label}` };
}

function buildBlocks(
  layout: readonly { kind: BlockKind; weight: number }[],
  durationMs: Millis,
): readonly SessionBlock[] {
  let remaining = durationMs;
  return layout.map((entry, index) => {
    const ms =
      index === layout.length - 1 ? remaining : Math.floor(durationMs * entry.weight);
    remaining -= ms;
    return { kind: entry.kind, budgetMs: ms };
  });
}

function validateLesson(lesson: Lesson): Lesson {
  practiceSpecForLesson(lesson);
  if (lesson.exerciseSpec !== undefined) {
    const expected = lessonForExercise(lesson.exerciseSpec);
    if (lesson.practiceSpecId !== undefined || lesson.id !== expected.id || lesson.module !== expected.module ||
        lesson.skills.length !== 1 || lesson.skills[0] !== expected.skills[0]) throw new RangeError('lesson does not match exercise spec');
  }
  if (lesson.id.trim().length === 0) {
    throw new RangeError('lesson id must not be empty');
  }
  if (lesson.title.trim().length === 0) {
    throw new RangeError('lesson title must not be empty');
  }
  if (!['interval', 'chord', 'scale', 'function', 'rhythm', 'dictation', 'sight', 'audiation'].includes(lesson.module)) {
    throw new RangeError(`invalid lesson module ${String(lesson.module)}`);
  }
  if (lesson.skills.length === 0) {
    throw new RangeError(`lesson ${lesson.id} has no skills`);
  }
  if (lesson.directions.length === 0) {
    throw new RangeError(`lesson ${lesson.id} has no directions`);
  }
  for (const direction of lesson.directions) {
    if (direction !== 'asc' && direction !== 'desc' && direction !== 'harmonic') {
      throw new RangeError(`invalid lesson direction ${String(direction)}`);
    }
  }
  for (const skillId of lesson.skills) {
    const meta = getSkill(skillId);
    if (meta.kind === 'exercise' && lesson.exerciseSpec === undefined) throw new RangeError('exercise skill requires a specification');
    if (meta.domain !== lesson.module) {
      throw new RangeError(`skill ${skillId} is not in lesson module ${lesson.module}`);
    }
  }
  if (lesson.test !== undefined) {
    if (!Number.isInteger(lesson.test.repetitions) || lesson.test.repetitions <= 0) {
      throw new RangeError(`invalid lesson test repetitions ${lesson.test.repetitions}`);
    }
    if (
      !Number.isFinite(lesson.test.requirement) ||
      lesson.test.requirement <= 0 ||
      lesson.test.requirement > 1
    ) {
      throw new RangeError(`invalid lesson test requirement ${lesson.test.requirement}`);
    }
  }
  return lesson;
}

export function planSession(
  now: Millis,
  request: PracticeRequest,
  snapshot: DerivedSnapshot,
): SessionPlan {
  if (!Number.isFinite(now)) {
    throw new RangeError(`time must be a finite number, got ${now}`);
  }
  if (request.mode !== 'daily' && request.mode !== 'focus') {
    throw new RangeError(`invalid practice mode ${String(request.mode)}`);
  }
  if (!['interval', 'chord', 'scale', 'function', 'rhythm', 'dictation', 'sight', 'audiation', 'mixed'].includes(request.scope)) {
    throw new RangeError(`invalid practice scope ${String(request.scope)}`);
  }
  if (request.limit !== undefined) {
    if (!Number.isInteger(request.limit) || request.limit <= 0) {
      throw new RangeError(`limit must be a positive integer, got ${request.limit}`);
    }
  }

  const targetP = request.targetP ?? TARGET_P;
  if (!Number.isFinite(targetP) || targetP <= 0 || targetP >= 1) {
    throw new RangeError(`targetP must be in (0, 1), got ${targetP}`);
  }

  const timbre = request.timbre ?? 'piano';
  if (!TIMBRES.includes(timbre)) {
    throw new RangeError(`invalid timbre ${String(timbre)}`);
  }

  const lesson = request.lesson === undefined ? undefined : validateLesson(request.lesson);
  if (request.scope === 'scale' && lesson === undefined) {
    throw new RangeError('scale practice requires a lesson');
  }
  if (lesson === undefined && !['interval', 'chord', 'mixed'].includes(request.scope)) throw new RangeError('exercise practice requires a lesson');
  if (lesson !== undefined && request.mode !== 'focus') {
    throw new RangeError('lesson sessions must use focus mode');
  }
  const scope: PracticeScope =
    lesson === undefined
      ? request.scope
      : lesson.module;

  const defaultDuration = request.mode === 'daily' ? DAILY_MS : FOCUS_MS;
  const durationMs = request.durationMs ?? defaultDuration;
  if (!Number.isInteger(durationMs) || durationMs <= 0) {
    throw new RangeError(`durationMs must be a positive integer, got ${durationMs}`);
  }

  const focus =
    lesson !== undefined
      ? { kind: 'mixed' as const, reason: lesson.title }
      : request.mode === 'daily'
        ? dailyFocus(scope, snapshot, now)
        : validateFocus(request.focus, scope);

  const blocks =
    lesson !== undefined || request.mode === 'focus'
      ? [{ kind: 'core' as const, budgetMs: durationMs }]
      : buildBlocks(DAILY_LAYOUT, durationMs);

  return {
    stage: STAGE,
    blocks,
    totalMs: durationMs,
    mode: request.mode,
    scope,
    targetP,
    timbre,
    focus,
    ...(lesson === undefined ? {} : { lesson }),
  };
}

function deriveSnapshot(attempts: readonly Attempt[], clock: Clock): DerivedSnapshot {
  return {
    ability: replayAbility(attempts),
    schedule: replaySchedule(attempts, clock),
    confusion: [],
  };
}

export function createSession(
  attempts: readonly Attempt[],
  now: Millis,
  request: PracticeRequest,
  clock: Clock,
): SessionState {
  const snapshot = deriveSnapshot(attempts, clock);
  return {
    request,
    plan: planSession(now, request, snapshot),
    attempts: [...attempts],
    snapshot,
    itemsCompleted: 0,
  };
}

export function nextItem(
  state: SessionState,
  now: Millis,
  rng: Rng,
  rngFactory: RngFactory,
): NextItem | null {
  const limit = state.request.limit ?? state.plan.lesson?.exerciseSpec?.questionCount ?? state.plan.lesson?.practiceSpec?.questionCount;
  if (limit !== undefined && state.itemsCompleted >= limit) {
    return null;
  }
  return selectNext(state.plan, state.snapshot, now, rng, rngFactory);
}

function assertItemSnapshot(item: NextItem): void {
  const templateKey = item.presented.templateKey;
  if (typeof templateKey !== 'string' || templateKey.trim().length === 0) {
    throw new RangeError('templateKey must be a non-empty string');
  }
  if (!Number.isFinite(item.itemRating)) {
    throw new RangeError('itemRating must be finite');
  }
  if (!Number.isFinite(item.predictedP) || item.predictedP < 0 || item.predictedP > 1) {
    throw new RangeError('predictedP must be in [0, 1]');
  }
}

export function commit(
  state: SessionState,
  item: NextItem,
  judgement: Judgement,
  now: Millis,
  clock: Clock,
): { state: SessionState; attempt: Attempt } {
  assertItemSnapshot(item);
  if (!Number.isFinite(now)) {
    throw new RangeError(`time must be a finite number, got ${now}`);
  }

  const reviewKeys = [
    ...new Set<ScheduleKey>([
      item.presented.skill,
      ...item.presented.targets,
      ...(judgement.confusion === null ? [] : [judgement.confusion]),
    ]),
  ];

  const lessonId = state.plan.lesson?.id;
  const context =
    lessonId !== undefined
      ? ('lesson' as const)
      : state.request.mode === 'focus'
        ? ('focus' as const)
        : ('daily' as const);

  const attempt: Attempt = {
    id: `attempt-${state.attempts.length}-${item.presented.id}`,
    itemId: item.presented.id,
    templateKey: item.presented.templateKey,
    skill: item.presented.skill,
    itemRating: item.itemRating,
    predictedP: item.predictedP,
    reviewKeys,
    at: now,
    judgement,
    context,
    ...(lessonId === undefined ? {} : { lessonId }),
    schemaVersion: 2,
  };

  const attempts = [...state.attempts, attempt];
  return {
    state: {
      request: state.request,
      plan: state.plan,
      attempts,
      snapshot: deriveSnapshot(attempts, clock),
      itemsCompleted: state.itemsCompleted + 1,
    },
    attempt,
  };
}
