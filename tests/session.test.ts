import { replay as replayAbility } from '@engine/ability';
import { createEntry, replay as replaySchedule } from '@engine/schedule';
import { judge } from '@engine/scoring';
import {
  commit,
  createSession,
  nextItem,
  planSession,
  type SessionState,
} from '@engine/session';
import type { NextItem } from '@engine/selection';
import type {
  AnswerKey,
  Attempt,
  Clock,
  DerivedSnapshot,
  Judgement,
  PracticeRequest,
  SkillId,
  TrainingFocus,
} from '@engine/ports';
import { makeRng, makeRngFactory } from './support/rng';

const BUDGET_MS = 25 * 60 * 1_000;
const FOCUS_MS = 10 * 60 * 1_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const ANCHOR = 4 * HOUR_MS;

const clock: Clock = {
  now: () => 0,
  dayStart: (t: number) => Math.floor((t - ANCHOR) / DAY_MS) * DAY_MS + ANCHOR,
};

const factory = makeRngFactory();
const skill: SkillId = 'interval.identify.m3';

const dailyRequest: PracticeRequest = {
  mode: 'daily',
  scope: 'mixed',
  durationMs: BUDGET_MS,
  targetP: 0.82,
};

function focusRequest(focus: TrainingFocus, limit = 5): PracticeRequest {
  return {
    mode: 'focus',
    scope: 'mixed',
    focus,
    limit,
    durationMs: FOCUS_MS,
    targetP: 0.82,
  };
}

function snapshot(): DerivedSnapshot {
  return { ability: [], schedule: [], confusion: [] };
}

function judgement(partial: number): Judgement {
  return {
    correct: partial === 1,
    partial,
    errorType: partial === 1 ? 'none' : 'pitch',
    confusion: null,
    cents: null,
    rtMs: 900,
  };
}

function choiceKey(item: NextItem): Extract<AnswerKey, { type: 'choice' }> {
  if (item.key.type !== 'choice') throw new Error('expected choice key');
  return item.key;
}

function requireItem(item: NextItem | null): NextItem {
  if (item === null) throw new Error('expected an item');
  return item;
}

function correctJudgement(item: NextItem): Judgement {
  const key = choiceKey(item);
  return judge(item.presented, key, { kind: 'choice', index: key.index, rtMs: 900 });
}

describe('session planning', () => {
  it('plans six daily blocks that exactly fill the budget', () => {
    const plan = planSession(0, dailyRequest, snapshot());
    const total = plan.blocks.reduce((sum, block) => sum + block.budgetMs, 0);

    expect(plan.mode).toBe('daily');
    expect(plan.stage).toBe('S1');
    expect(plan.blocks).toHaveLength(6);
    expect(total).toBe(BUDGET_MS);
    expect(plan.totalMs).toBe(BUDGET_MS);
  });

  it('plans one focus core block', () => {
    const plan = planSession(
      0,
      focusRequest({ kind: 'skill', skill, reason: '专项' }),
      snapshot(),
    );

    expect(plan.mode).toBe('focus');
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]).toEqual({ kind: 'core', budgetMs: FOCUS_MS });
    expect(plan.focus.kind).toBe('skill');
  });

  it('chooses due focus when something is due on a daily plan', () => {
    const entry = createEntry(skill, 0, clock);
    const plan = planSession(0, dailyRequest, {
      ability: [],
      schedule: [entry],
      confusion: [],
    });

    expect(plan.focus.kind).toBe('due');
  });

  it('defaults to piano and accepts another timbre', () => {
    const piano = planSession(0, dailyRequest, snapshot());
    const strings = planSession(0, { ...dailyRequest, timbre: 'strings' }, snapshot());

    expect(piano.timbre).toBe('piano');
    expect(strings.timbre).toBe('strings');
  });
});

describe('session commit', () => {
  it('creates an empty session from empty attempts', () => {
    const state = createSession([], 0, dailyRequest, clock);
    expect(state.itemsCompleted).toBe(0);
    expect(state.attempts).toEqual([]);
    expect(state.snapshot.ability).toEqual([]);
    expect(state.snapshot.schedule).toEqual([]);
  });

  it('commits a complete daily Attempt and advances SRS', () => {
    const state = createSession([], 0, dailyRequest, clock);
    const item = requireItem(nextItem(state, 0, makeRng(1), factory));
    const result = commit(state, item, correctJudgement(item), 1, clock);
    const attempt = result.attempt;

    expect(attempt.context).toBe('daily');
    expect(attempt.reviewKeys).toContain(attempt.skill);
    expect(new Set(attempt.reviewKeys).size).toBe(attempt.reviewKeys.length);
    expect(result.state.itemsCompleted).toBe(1);
    expect(result.state.snapshot.ability).toEqual(replayAbility(result.state.attempts));
    expect(result.state.snapshot.schedule).toEqual(
      replaySchedule(result.state.attempts, clock),
    );

    const entry = result.state.snapshot.schedule.find((item) => item.key === attempt.skill);
    expect(entry?.reps).toBe(1);
  });

  it('keeps attempt ids unique across commits', () => {
    const first = createSession([], 0, dailyRequest, clock);
    const firstItem = requireItem(nextItem(first, 0, makeRng(2), factory));
    const firstCommit = commit(first, firstItem, correctJudgement(firstItem), 1, clock);

    const secondItem = requireItem(
      nextItem(firstCommit.state, 2, makeRng(3), factory),
    );
    const secondCommit = commit(
      firstCommit.state,
      secondItem,
      correctJudgement(secondItem),
      3,
      clock,
    );

    expect(secondCommit.attempt.id).not.toBe(firstCommit.attempt.id);
    expect(secondCommit.state.attempts).toHaveLength(2);
  });

  it('puts a wrong-answer confusion into reviewKeys and fails the pair', () => {
    const due = createEntry(skill, 0, clock);
    const snap: DerivedSnapshot = {
      ability: [],
      schedule: [due],
      confusion: [],
    };
    const plan = planSession(0, dailyRequest, snap);
    const state: SessionState = {
      request: dailyRequest,
      plan,
      attempts: [],
      snapshot: snap,
      itemsCompleted: 0,
    };

    const item = requireItem(nextItem(state, 0, makeRng(4), factory));
    expect(item.presented.skill).toBe(skill);
    const options = item.presented.options;
    if (options === null) throw new Error('expected options');
    const wrong = options.indexOf('M3');
    if (wrong < 0) throw new Error('expected M3 option');
    const key = choiceKey(item);
    const wrongJudgement = judge(item.presented, key, {
      kind: 'choice',
      index: wrong,
      rtMs: 1_200,
    });
    const confusion = wrongJudgement.confusion;
    if (confusion === null) throw new Error('expected confusion');

    const result = commit(state, item, wrongJudgement, 1, clock);
    expect(result.attempt.reviewKeys).toContain(skill);
    expect(result.attempt.reviewKeys).toContain(confusion);

    const pair = result.state.snapshot.schedule.find((entry) => entry.key === confusion);
    const skillEntry = result.state.snapshot.schedule.find((entry) => entry.key === skill);
    expect(pair?.reps).toBe(0);
    expect(pair?.intervalDays).toBe(1);
    expect(skillEntry?.reps).toBe(0);
    expect(skillEntry?.intervalDays).toBe(1);
  });
});

describe('focus sessions', () => {
  it('does not advance SRS, but does update ability', () => {
    const state = createSession(
      [],
      0,
      focusRequest({ kind: 'skill', skill, reason: '专项' }),
      clock,
    );
    const item = requireItem(nextItem(state, 0, makeRng(5), factory));
    expect(item.presented.skill).toBe(skill);

    const result = commit(state, item, correctJudgement(item), 1, clock);
    const ability = result.state.snapshot.ability.find((entry) => entry.skill === skill);

    expect(result.attempt.context).toBe('focus');
    expect(ability?.n).toBe(1);
    expect(result.state.snapshot.schedule).toEqual([]);
    expect(replaySchedule(result.state.attempts, clock)).toEqual([]);
  });

  it('returns null after the focus limit', () => {
    const state = createSession(
      [],
      0,
      focusRequest({ kind: 'pair', pair: 'm3:M3', reason: '易混对' }, 5),
      clock,
    );
    let current = state;

    for (let i = 0; i < 5; i += 1) {
      const item = requireItem(nextItem(current, i, makeRng(10 + i), factory));
      current = commit(current, item, correctJudgement(item), i + 1, clock).state;
    }

    expect(current.itemsCompleted).toBe(5);
    expect(nextItem(current, 10, makeRng(99), factory)).toBeNull();
    expect(current.snapshot.schedule).toEqual([]);
  });
});

describe('legacy attempts', () => {
  it('treats attempts without context as daily', () => {
    const legacy: Attempt = {
      id: 'legacy',
      itemId: 'item-legacy',
      templateKey: 'template-legacy',
      skill,
      itemRating: 1_000,
      predictedP: 0.8,
      reviewKeys: [skill],
      at: 0,
      judgement: judgement(1),
      schemaVersion: 2,
    };

    expect(legacy.context).toBeUndefined();
    expect(replaySchedule([legacy], clock)).toHaveLength(1);

    const state = createSession([legacy], 0, dailyRequest, clock);
    expect(state.snapshot.schedule).toHaveLength(1);
  });
});
