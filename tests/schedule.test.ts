import {
  createEntry,
  DAY_MS,
  DEFAULT_EASE,
  due,
  gradeOf,
  replay,
  review,
  SRS_INTERVALS_DAYS,
  type SrsGrade,
} from '@engine/schedule';
import type {
  Attempt,
  Clock,
  ConfusionKey,
  Judgement,
  ScheduleEntry,
  ScheduleKey,
  SkillId,
} from '@engine/ports';

const pair: ConfusionKey = 'P4:P5';
const skill: SkillId = 'interval.identify.maj3.melodic';
const HOUR_MS = 3_600_000;
const ANCHOR = 4 * HOUR_MS;

const clock: Clock = {
  now: () => 0,
  dayStart: (t: number) => Math.floor((t - ANCHOR) / DAY_MS) * DAY_MS + ANCHOR,
};

function judgement(
  partial: number,
  rtMs = 1_000,
  confusion: ConfusionKey | null = null,
): Judgement {
  return {
    correct: partial === 1,
    partial,
    errorType: 'none',
    confusion,
    cents: null,
    rtMs,
  };
}

function attempt(
  id: string,
  at: number,
  reviewKeys: readonly ScheduleKey[],
  options: { partial?: number; rtMs?: number; confusion?: ConfusionKey | null } = {},
): Attempt {
  const partial = options.partial ?? 1;
  const keys = reviewKeys.includes(skill) ? reviewKeys : [skill, ...reviewKeys];
  return {
    id,
    itemId: `item-${id}`,
    templateKey: `template-${id}`,
    skill,
    itemRating: 1200,
    predictedP: 0.8,
    reviewKeys: keys,
    at,
    judgement: judgement(partial, options.rtMs ?? 1_000, options.confusion ?? null),
    schemaVersion: 2,
  };
}

function entry(key: ScheduleKey, dueAt: number): ScheduleEntry {
  return { key, dueAt, intervalDays: 1, ease: 2.5, reps: 1 };
}

describe('schedule', () => {
  it('exposes the 1/3/7/16/35 ladder and default ease', () => {
    expect(SRS_INTERVALS_DAYS).toEqual([1, 3, 7, 16, 35]);
    expect(DEFAULT_EASE).toBe(2.5);
  });

  it('anchors new entries to the natural-day start', () => {
    const evening = ANCHOR + 18 * HOUR_MS;
    const created = createEntry(pair, evening, clock);
    expect(created.dueAt).toBe(ANCHOR);
    expect(created.intervalDays).toBe(0);
    expect(() => createEntry(' P4:P5', evening, clock)).toThrow(RangeError);
  });

  it('maps judgements to the documented SRS grade table', () => {
    expect(gradeOf(judgement(1, 2_000))).toBe(5);
    expect(gradeOf(judgement(1, 2_001))).toBe(4);
    expect(gradeOf(judgement(0.8))).toBe(3);
    expect(gradeOf(judgement(0.8 - Number.EPSILON))).toBe(2);
    expect(gradeOf(judgement(0.5))).toBe(2);
    expect(gradeOf(judgement(0.5 - Number.EPSILON))).toBe(0);
    expect(gradeOf(judgement(0.2))).toBe(0);
    expect(gradeOf(judgement(0.2, 1_000, pair))).toBe(1);
    expect(() => gradeOf({ ...judgement(0.8), correct: true })).toThrow(RangeError);
    expect(() => gradeOf({ ...judgement(1), correct: false })).toThrow(RangeError);
    expect(() => gradeOf(judgement(1, -1))).toThrow(RangeError);
  });

  it('advances through the ladder on grade 4', () => {
    let current = createEntry(pair, 0, clock);
    const intervals: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      current = review(current, 4, i * 1_000, clock);
      intervals.push(current.intervalDays);
    }
    expect(intervals).toEqual([1, 3, 7, 16, 35]);
    expect(current.reps).toBe(5);
    expect(current.ease).toBe(2.5);
  });

  it('never shrinks a passing interval over 12 grade-3 reviews', () => {
    let current = createEntry(pair, 0, clock);
    const intervals: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      current = review(current, 3, i * DAY_MS, clock);
      intervals.push(current.intervalDays);
    }

    for (let i = 1; i < 5; i += 1) {
      expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]!);
    }
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i]!).toBeGreaterThanOrEqual(intervals[i - 1]!);
    }
  });

  it('schedules a pass on the next natural day, not after 24h', () => {
    const evening = ANCHOR + 18 * HOUR_MS;
    let current = createEntry(pair, evening, clock);
    current = review(current, 4, evening, clock);

    expect(current.dueAt).toBe(ANCHOR + DAY_MS);
    const nextEvening = ANCHOR + DAY_MS + 20 * HOUR_MS;
    expect(due([current], nextEvening)).toHaveLength(1);
    expect(due([current], ANCHOR + DAY_MS - 1)).toHaveLength(0);
  });

  it('schedules a failure on the next natural day', () => {
    const evening = ANCHOR + 18 * HOUR_MS;
    let current = createEntry(pair, evening, clock);
    current = review(current, 0, evening, clock);

    expect(current.dueAt).toBe(ANCHOR + DAY_MS);
    expect(current.intervalDays).toBe(1);
    expect(current.reps).toBe(0);
  });

  it('creates then reviews on first appearance in replay', () => {
    const evening = ANCHOR + 18 * HOUR_MS;
    const replayed = replay([attempt('a', evening, [pair])], clock);
    const result = replayed[0];

    expect(result?.key).toBe(pair);
    expect(result?.reps).toBe(1);
    expect(result?.intervalDays).toBe(1);
    expect(result?.dueAt).toBe(ANCHOR + DAY_MS);
  });

  it('applies reviewKeys and derives pass/fail from the judgement', () => {
    const evening = ANCHOR + 18 * HOUR_MS;
    const passed = replay([attempt('a', evening, [skill, pair])], clock);
    expect(passed.map((item) => item.key)).toEqual([pair, skill]);
    expect(passed.every((item) => item.reps === 1)).toBe(true);

    const failed = replay(
      [attempt('b', evening, [skill, pair], { partial: 0.2 })],
      clock,
    );
    expect(failed.map((item) => item.key)).toEqual([pair, skill]);
    expect(failed.every((item) => item.reps === 0)).toBe(true);
    expect(failed.every((item) => item.intervalDays === 1)).toBe(true);
  });

  it('falls back to skill for v1 attempts without reviewKeys', () => {
    const legacy = {
      id: 'legacy',
      itemId: 'item-legacy',
      skill,
      at: ANCHOR,
      judgement: judgement(1),
      schemaVersion: 1,
    } as unknown as Attempt;

    const replayed = replay([legacy], clock);
    expect(replayed.map((item) => item.key)).toEqual([skill]);
    expect(replayed[0]?.reps).toBe(1);
  });

  it('rejects duplicate keys and bad grades', () => {
    expect(() => due([entry(pair, 100), entry(pair, 200)], 200)).toThrow(/duplicate/);
    expect(() =>
      replay([attempt('a', 0, [pair, pair])], clock),
    ).toThrow(/duplicate/);
    expect(() =>
      replay(
        [
          attempt('a', 0, [pair]),
          attempt('a', 1, [pair]),
        ],
        clock,
      ),
    ).toThrow(/duplicate/);

    const missingSkill = {
      ...attempt('missing', 0, [pair]),
      reviewKeys: [pair],
    };
    expect(() => replay([missingSkill], clock)).toThrow(/reviewKeys must include attempt.skill/);

    const created = createEntry(pair, 0, clock);
    expect(() => review(created, 6 as SrsGrade, 0, clock)).toThrow(RangeError);
    expect(() => review(created, -1 as SrsGrade, 0, clock)).toThrow(RangeError);
    expect(() =>
      due([{ key: pair, dueAt: 0, intervalDays: 0, ease: 9, reps: 0 }], 0),
    ).toThrow(RangeError);
  });

  it('clamps ease at both ends', () => {
    let failed = createEntry(pair, 0, clock);
    for (let i = 0; i < 20; i += 1) {
      failed = review(failed, 0, i * DAY_MS, clock);
    }
    expect(failed.ease).toBeCloseTo(1.3, 10);

    let passed = createEntry(pair, 0, clock);
    for (let i = 0; i < 20; i += 1) {
      passed = review(passed, 5, i * DAY_MS, clock);
    }
    expect(passed.ease).toBeCloseTo(2.8, 10);
  });

  it('resets a mature entry on failure', () => {
    let current = createEntry(pair, 0, clock);
    for (let i = 0; i < 5; i += 1) {
      current = review(current, 4, i, clock);
    }
    expect(current.intervalDays).toBe(35);

    current = review(current, 0, 5, clock);
    expect(current.intervalDays).toBe(1);
    expect(current.reps).toBe(0);
  });

  it('returns only due entries, sorted by due time then key', () => {
    const entries = [entry('P4:P5', 200), entry('P5:M6', 100), entry('M3:M2', 300)];
    expect(due(entries, 200).map((item) => item.key)).toEqual(['P5:M6', 'P4:P5']);
    expect(due(entries, 99)).toEqual([]);
  });
});
