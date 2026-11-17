import {
  DEFAULT_RATING,
  initial,
  kFactor,
  predictSuccess,
  replay,
  scoreOf,
  updateAbility,
} from '@engine/ability';
import type { Attempt, Judgement, SkillId } from '@engine/ports';

const skillA: SkillId = 'chord.identify.maj.root';
const skillB: SkillId = 'interval.identify.maj3.melodic';

function judgement(partial: number, rtMs = 1_000): Judgement {
  return {
    correct: partial === 1,
    partial,
    errorType: 'none',
    confusion: null,
    cents: null,
    rtMs,
  };
}

function attempt(
  id: string,
  skill: SkillId,
  at: number,
  itemRating: number,
  partial = 1,
): Attempt {
  return {
    id,
    itemId: `item-${id}`,
    templateKey: `template-${id}`,
    skill,
    itemRating,
    predictedP: 0.8,
    reviewKeys: [skill],
    at,
    judgement: judgement(partial),
    schemaVersion: 2,
  };
}

describe('ability', () => {
  it('predicts success monotonically and within (0, 1)', () => {
    const state = initial(skillA, 1200, 0);
    expect(predictSuccess(state, 1200)).toBe(0.5);
    expect(predictSuccess(state, 1000)).toBeGreaterThan(0.5);
    expect(predictSuccess(state, 1400)).toBeLessThan(0.5);
    expect(predictSuccess(state, 3000)).toBeGreaterThan(0);
    expect(predictSuccess(state, 3000)).toBeLessThan(0.5);
    expect(predictSuccess(state, -3000)).toBeGreaterThan(0.5);
    expect(predictSuccess(state, -3000)).toBeLessThan(1);

    const low = predictSuccess(state, 1600);
    const mid = predictSuccess(state, 1200);
    const high = predictSuccess(state, 800);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(() => predictSuccess(state, Number.NaN)).toThrow(RangeError);
  });

  it('decays K with attempt count', () => {
    expect(kFactor(0)).toBe(32);
    expect(kFactor(10)).toBeLessThan(kFactor(0));
    expect(kFactor(1000)).toBe(4);
    expect(() => kFactor(-1)).toThrow(RangeError);
  });

  it('moves the internal ability toward the outcome', () => {
    const start = initial(skillA, 1000, 0);
    const win = updateAbility(start, 1200, 1, 1_000);
    expect(win.rating).toBeGreaterThan(1000);
    expect(win.n).toBe(1);
    expect(win.updatedAt).toBe(1_000);

    const loss = updateAbility(start, 1200, 0, 1_000);
    expect(loss.rating).toBeLessThan(1000);

    const draw = updateAbility(start, 1000, 0.5, 1_000);
    expect(draw.rating).toBeCloseTo(1000, 10);
  });

  it('maps partial scores and enforces correct/partial consistency', () => {
    expect(scoreOf(judgement(1))).toBe(1);
    expect(scoreOf(judgement(0.8))).toBe(0.8);
    expect(scoreOf(judgement(0.5))).toBe(0.5);
    expect(() => scoreOf({ ...judgement(0.8), correct: true })).toThrow(RangeError);
    expect(() => scoreOf({ ...judgement(1), correct: false })).toThrow(RangeError);
    expect(() => scoreOf({ ...judgement(1), partial: 1.2 })).toThrow(RangeError);
  });

  it('replays attempts in (at, id) order deterministically', () => {
    const later = attempt('b', skillA, 200, 1200, 1);
    const earlier = attempt('a', skillA, 100, 1200, 0);

    const replayed = replay([later, earlier]);
    const expectedState = updateAbility(
      updateAbility(initial(skillA, DEFAULT_RATING, 100), 1200, 0, 100),
      1200,
      1,
      200,
    );

    expect(replayed).toEqual([expectedState]);
  });

  it('orders same-timestamp attempts by id', () => {
    const first = attempt('a', skillA, 100, 1200, 0);
    const second = attempt('b', skillA, 100, 1200, 1);

    const expectedState = updateAbility(
      updateAbility(initial(skillA, DEFAULT_RATING, 100), 1200, 0, 100),
      1200,
      1,
      100,
    );

    expect(replay([second, first])).toEqual([expectedState]);
  });

  it('keeps skills independent and sorts the result', () => {
    const replayed = replay([
      attempt('b', skillB, 10, 1200, 1),
      attempt('a', skillA, 10, 1200, 1),
    ]);

    expect(replayed.map((state) => state.skill)).toEqual([skillA, skillB]);
    expect(replayed.every((state) => state.n === 1)).toBe(true);
  });

  it('falls back for v1 attempts missing itemRating', () => {
    const legacy = {
      id: 'legacy',
      itemId: 'item-legacy',
      skill: skillA,
      at: 100,
      judgement: judgement(1),
      schemaVersion: 1,
    } as unknown as Attempt;

    const replayed = replay([legacy], 1000, 1200);
    const expectedState = updateAbility(initial(skillA, 1000, 100), 1200, 1, 100);

    expect(replayed).toEqual([expectedState]);
  });

  it('rejects v2 attempts without itemRating and duplicate ids', () => {
    const broken = {
      ...attempt('broken', skillA, 100, 1200, 1),
      itemRating: undefined,
    } as unknown as Attempt;

    expect(() => replay([broken])).toThrow(RangeError);
    expect(replay([])).toEqual([]);
    expect(() =>
      replay([attempt('a', skillA, 0, 1200, 1), attempt('a', skillA, 1, 1200, 1)]),
    ).toThrow(/duplicate/);
  });
});
