import { initial } from '@engine/ability';
import { getSkill, SKILLS } from '@engine/config';
import { createEntry } from '@engine/schedule';
import { next, TARGET_P } from '@engine/selection';
import { planSession } from '@engine/session';
import type {
  AbilityState,
  Clock,
  DerivedSnapshot,
  PracticeRequest,
  ScheduleEntry,
  SkillId,
} from '@engine/ports';
import { makeRng, makeRngFactory } from './support/rng';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const ANCHOR = 4 * HOUR_MS;
const BUDGET_MS = 25 * 60 * 1_000;

const clock: Clock = {
  now: () => 0,
  dayStart: (t: number) => Math.floor((t - ANCHOR) / DAY_MS) * DAY_MS + ANCHOR,
};

const factory = makeRngFactory();

const dailyRequest: PracticeRequest = {
  mode: 'daily',
  scope: 'mixed',
  durationMs: BUDGET_MS,
  targetP: TARGET_P,
};

function snapshot(
  ability: readonly AbilityState[] = [],
  schedule: readonly ScheduleEntry[] = [],
): DerivedSnapshot {
  return { ability, schedule, confusion: [] };
}

function planFor(snap: DerivedSnapshot, request: PracticeRequest = dailyRequest) {
  return planSession(0, request, snap);
}

describe('selection', () => {
  it('prefers a due skill', () => {
    const skill: SkillId = 'interval.identify.m3';
    const entry = createEntry(skill, 0, clock);
    const snap = snapshot([], [entry]);
    const result = next(planFor(snap), snap, 0, makeRng(1), factory);

    expect(result.presented.skill).toBe(skill);
    expect(result.predictedP).toBeGreaterThanOrEqual(0);
    expect(result.predictedP).toBeLessThanOrEqual(1);
  });

  it('maps a due confusion pair back to a skill', () => {
    const entry = createEntry('m3:M3', 0, clock);
    const snap = snapshot([], [entry]);
    const result = next(planFor(snap), snap, 0, makeRng(2), factory);
    const meta = getSkill(result.presented.skill);

    expect(meta.pairs).toContain('m3:M3');
  });

  it('picks the candidate closest to the plan target p', () => {
    const skill: SkillId = 'interval.identify.p5';
    const state: AbilityState = { skill, rating: 1_250, n: 5, updatedAt: 0 };
    const entry = createEntry(skill, 0, clock);
    const snap = snapshot([state], [entry]);
    const result = next(planFor(snap), snap, 0, makeRng(3), factory);

    expect(result.predictedP).toBeGreaterThanOrEqual(0);
    expect(result.predictedP).toBeLessThanOrEqual(1);
    expect(Math.abs(result.predictedP - TARGET_P)).toBeLessThan(0.1);
  });

  it('is deterministic for the same seed and rng state', () => {
    const snap = snapshot();
    const plan = planFor(snap);
    const first = next(plan, snap, 0, makeRng(4), factory);
    const repeat = next(plan, snap, 0, makeRng(4), factory);
    expect(repeat).toEqual(first);
  });

  it('only adapts register/direction/reference and fixes the rest', () => {
    const snap = snapshot();
    const result = next(planFor(snap), snap, 0, makeRng(5), factory);
    const features = result.presented.features;

    expect(['low', 'mid', 'high']).toContain(features.register);
    expect(['asc', 'desc', 'harmonic']).toContain(features.direction);
    expect(['none', 'tonic', 'chord']).toContain(features.reference);
    expect(features.timbre).toBe('piano');
    expect(features.tempoBpm).toBe(120);
    expect(features.voices).toBe(1);
    expect(features.bars).toBe(1);
    expect(features.chunk).toBe(1);
  });

  it('uses the requested default timbre for a new session', () => {
    const snap = snapshot();
    const request: PracticeRequest = { ...dailyRequest, timbre: 'strings' };
    const result = next(planFor(snap, request), snap, 0, makeRng(5), factory);

    expect(result.presented.features.timbre).toBe('strings');
  });

  it('restricts a pair focus to skills containing that pair', () => {
    const request: PracticeRequest = {
      mode: 'focus',
      scope: 'mixed',
      focus: { kind: 'pair', pair: 'm3:M3', reason: '易混对' },
      limit: 5,
      durationMs: 10 * 60 * 1000,
      targetP: TARGET_P,
    };
    const snap = snapshot();
    const result = next(planFor(snap, request), snap, 0, makeRng(6), factory);

    expect(getSkill(result.presented.skill).pairs).toContain('m3:M3');
  });

  it('restricts a skill focus to exactly that skill', () => {
    const skill: SkillId = 'interval.identify.p5';
    const request: PracticeRequest = {
      mode: 'focus',
      scope: 'mixed',
      focus: { kind: 'skill', skill, reason: '专项' },
      limit: 5,
      durationMs: 10 * 60 * 1000,
      targetP: TARGET_P,
    };
    const snap = snapshot();
    const result = next(planFor(snap, request), snap, 0, makeRng(7), factory);

    expect(result.presented.skill).toBe(skill);
  });

  it('does not start with chord.identify.dim when all skills are new', () => {
    const ability = SKILLS.filter((skill) => skill.stage === 'S1').map((skill) =>
      initial(skill.id, 1_200, 0),
    );
    const snap = snapshot(ability);
    const result = next(planFor(snap), snap, 0, makeRng(8), factory);

    expect(result.presented.skill).not.toBe('chord.identify.dim');
    expect(result.presented.skill.startsWith('interval.identify.')).toBe(true);
  });

  it('uses coverage when nothing is due', () => {
    const stageSkills = SKILLS.filter((skill) => skill.stage === 'S1');
    const first = stageSkills[0];
    if (first === undefined) throw new Error('missing S1 skills');

    const ability = stageSkills.map((skill) =>
      skill.id === first.id
        ? { ...initial(skill.id, 1_000, 0), n: 0 }
        : { ...initial(skill.id, 1_000, 0), n: 5 },
    );
    const snap = snapshot(ability);
    const request: PracticeRequest = { ...dailyRequest, mode: 'daily' };
    const result = next(planFor(snap, request), snap, 0, makeRng(9), factory);

    expect(result.presented.skill).toBe(first.id);
  });
});
