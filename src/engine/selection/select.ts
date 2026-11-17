import type {
  AbilityState,
  AnswerKey,
  ConfusionKey,
  DerivedSnapshot,
  Direction,
  ItemFeatures,
  Millis,
  Pitch,
  PresentedItem,
  Reference,
  Register,
  Rng,
  RngFactory,
  ScheduleKey,
  SessionPlan,
  SkillId,
  StageId,
  SuccessPrediction,
  TimbreId,
  Score,
} from '../ports';
import { DEFAULT_RATING, initial, predictSuccess } from '../ability';
import { getSkill, SKILLS, templateRating, practiceSpecForLesson, type SkillMeta } from '../config';
import { generate, generateExercise } from '../items';
import { due as dueEntries } from '../schedule';

export const TARGET_P = 0.82;

export interface NextItem {
  readonly answerScore?: Score;
  readonly presented: PresentedItem;
  readonly key: AnswerKey;
  readonly itemRating: number;
  readonly predictedP: SuccessPrediction;
  /** 仅用于答后揭示；不要放进 PresentedItem。 */
  readonly answerPitches: readonly Pitch[];
}

interface Candidate {
  readonly features: ItemFeatures;
  readonly itemRating: number;
  readonly predictedP: number;
  readonly error: number;
}

const REGISTERS: readonly Register[] = ['low', 'mid', 'high'];
const DIRECTIONS: readonly Direction[] = ['asc', 'desc', 'harmonic'];
const REFERENCES: readonly Reference[] = ['none', 'tonic', 'chord'];

function inScope(skill: SkillMeta, scope: PlanScope): boolean {
  return scope === 'mixed' || skill.domain === scope;
}

type PlanScope = SessionPlan['scope'];

function scopeSkills(stage: StageId, scope: PlanScope): readonly SkillMeta[] {
  return SKILLS.filter((skill) => skill.stage === stage && inScope(skill, scope));
}

function skillForDueKey(key: ScheduleKey, skills: readonly SkillMeta[]): SkillMeta | undefined {
  return (
    skills.find((skill) => skill.id === key) ??
    skills.find((skill) => skill.pairs.includes(key as ConfusionKey))
  );
}

function bestCandidate(
  skill: SkillMeta,
  ability: AbilityState,
  targetP: number,
  directions: readonly Direction[] = DIRECTIONS,
  references: readonly Reference[] = REFERENCES,
  timbre: TimbreId = 'piano',
): Candidate {
  if (directions.length === 0) {
    throw new RangeError(`no directions for ${skill.id}`);
  }
  if (references.length === 0) {
    throw new RangeError(`no references for ${skill.id}`);
  }
  let best: Candidate | null = null;

  for (const register of REGISTERS) {
    for (const direction of directions) {
      for (const reference of references) {
        const features: ItemFeatures = {
          register,
          direction,
          reference,
          timbre,
          tempoBpm: 120,
          voices: 1,
          bars: 1,
          chunk: 1,
        };
        const itemRating = templateRating(skill.id, features);
        const predictedP = predictSuccess(ability, itemRating);
        const error = Math.abs(predictedP - targetP);

        if (best === null || error < best.error) {
          best = { features, itemRating, predictedP, error };
        }
      }
    }
  }

  if (best === null) {
    throw new RangeError(`no candidate features for ${skill.id}`);
  }
  return best;
}

function chooseByCoverage(
  skills: readonly SkillMeta[],
  stateFor: (skill: SkillId) => AbilityState,
  targetP: number,
  directions: readonly Direction[] = DIRECTIONS,
  references: readonly Reference[] = REFERENCES,
  timbre: TimbreId = 'piano',
): SkillMeta {
  const first = skills[0];
  if (first === undefined) {
    throw new RangeError('empty skill set');
  }

  let best = first;
  let bestState = stateFor(first.id);
  let bestCandidateValue = bestCandidate(first, bestState, targetP, directions, references, timbre);

  for (let i = 1; i < skills.length; i += 1) {
    const candidate = skills[i];
    if (candidate === undefined) continue;
    const state = stateFor(candidate.id);
    const candidateValue = bestCandidate(
      candidate,
      state,
      targetP,
      directions,
      references,
      timbre,
    );

    const better =
      state.n < bestState.n ||
      (state.n === bestState.n && state.updatedAt < bestState.updatedAt) ||
      (state.n === bestState.n &&
        state.updatedAt === bestState.updatedAt &&
        candidateValue.error < bestCandidateValue.error) ||
      (state.n === bestState.n &&
        state.updatedAt === bestState.updatedAt &&
        candidateValue.error === bestCandidateValue.error &&
        candidate.id < best.id);

    if (better) {
      best = candidate;
      bestState = state;
      bestCandidateValue = candidateValue;
    }
  }

  return best;
}

function skillsForFocus(
  plan: SessionPlan,
  stateFor: (skill: SkillId) => AbilityState,
): readonly SkillMeta[] {
  if (plan.lesson !== undefined) {
    return plan.lesson.skills.map((skill) => getSkill(skill));
  }

  const skills = scopeSkills(plan.stage, plan.scope);
  const focus = plan.focus;

  switch (focus.kind) {
    case 'pair': {
      const pair = focus.pair;
      if (pair === undefined) {
        throw new RangeError('pair focus is missing pair');
      }
      const matched = skills.filter((skill) => skill.pairs.includes(pair));
      if (matched.length === 0) {
        throw new RangeError(`no ${plan.scope} skill for pair ${pair}`);
      }
      return matched;
    }
    case 'skill': {
      const skillId = focus.skill;
      if (skillId === undefined) {
        throw new RangeError('skill focus is missing skill');
      }
      const matched = skills.filter((skill) => skill.id === skillId);
      if (matched.length === 0) {
        throw new RangeError(`skill ${skillId} is outside scope ${plan.scope}`);
      }
      return matched;
    }
    case 'new': {
      const matched = skills.filter((skill) => stateFor(skill.id).n === 0);
      if (matched.length === 0) {
        throw new RangeError(`no new ${plan.scope} skill`);
      }
      return matched;
    }
    case 'due':
    case 'mixed': {
      return skills;
    }
  }
}

function dueSkill(
  skills: readonly SkillMeta[],
  snapshot: DerivedSnapshot,
  now: Millis,
): SkillMeta | undefined {
  for (const entry of dueEntries(snapshot.schedule, now)) {
    const matched = skillForDueKey(entry.key, skills);
    if (matched !== undefined) return matched;
  }
  return undefined;
}

function chooseSkill(
  plan: SessionPlan,
  snapshot: DerivedSnapshot,
  now: Millis,
  stateFor: (skill: SkillId) => AbilityState,
): SkillMeta {
  const directions = plan.lesson?.directions ?? DIRECTIONS;
  const references: readonly Reference[] = plan.lesson === undefined ? REFERENCES : ['none'];
  const focus = plan.focus;
  if (focus.kind === 'pair' || focus.kind === 'skill' || focus.kind === 'new') {
    const candidates = skillsForFocus(plan, stateFor);
    return chooseByCoverage(
      candidates,
      stateFor,
      plan.targetP,
      directions,
      references,
      plan.timbre,
    );
  }

  const candidates = skillsForFocus(plan, stateFor);
  const fromDue = dueSkill(candidates, snapshot, now);
  if (fromDue !== undefined) return fromDue;

  return chooseByCoverage(candidates, stateFor, plan.targetP, directions, references, plan.timbre);
}

export function next(
  plan: SessionPlan,
  snapshot: DerivedSnapshot,
  now: Millis,
  rng: Rng,
  rngFactory: RngFactory,
): NextItem {
  if (!Number.isFinite(now)) {
    throw new RangeError(`time must be a finite number, got ${now}`);
  }

  const abilityBySkill = new Map<SkillId, AbilityState>(
    snapshot.ability.map((state) => [state.skill, state]),
  );
  const stateFor = (skill: SkillId): AbilityState =>
    abilityBySkill.get(skill) ?? initial(skill, DEFAULT_RATING, now);

  const exercise = plan.lesson?.exerciseSpec;
  if (exercise !== undefined) {
    const generated = generateExercise(exercise, rng.int(0x7fffffff), rngFactory, plan.timbre);
    return { ...generated, itemRating: exercise.itemRating,
      predictedP: predictSuccess(stateFor(generated.presented.skill), exercise.itemRating) };
  }

  const selected = chooseSkill(plan, snapshot, now, stateFor);
  const abilityState = stateFor(selected.id);
  const directions = plan.lesson?.directions ?? DIRECTIONS;
  const references: readonly Reference[] = plan.lesson === undefined ? REFERENCES : ['none'];
  const candidate = bestCandidate(
    selected,
    abilityState,
    plan.targetP,
    directions,
    references,
    plan.timbre,
  );
  const seed = rng.int(0x7fffffff);
  const optionCodes =
    plan.lesson === undefined ? undefined : plan.lesson.skills.map((skill) => getSkill(skill).code);
  const spec = practiceSpecForLesson(plan.lesson);
  const generated = generate(selected.id, candidate.features, seed, rngFactory, optionCodes, spec);
  const itemRating = templateRating(selected.id, generated.presented.features);

  return {
    presented: generated.presented,
    key: generated.key,
    itemRating,
    predictedP: predictSuccess(abilityState, itemRating),
    answerPitches: generated.answerPitches,
  };
}
