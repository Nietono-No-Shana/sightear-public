import type { Attempt, Clock, Judgement, Millis, ScheduleEntry, ScheduleKey } from '../ports';

export const DAY_MS = 86_400_000;
export const DEFAULT_EASE = 2.5;
export const SRS_INTERVALS_DAYS = [1, 3, 7, 16, 35] as const;

export type SrsGrade = 0 | 1 | 2 | 3 | 4 | 5;

const EASE_MIN = 1.3;
const EASE_MAX = 2.8;
const PASS_GRADE = 3;
const FAST_RT_MS = 2_000;

const EASE_DELTA: Readonly<Record<SrsGrade, number>> = {
  0: -0.8,
  1: -0.54,
  2: -0.32,
  3: -0.14,
  4: 0,
  5: 0.1,
};

function assertTime(now: Millis): void {
  if (!Number.isFinite(now)) {
    throw new RangeError(`time must be a finite number, got ${now}`);
  }
}

function dayStartOf(clock: Clock, now: Millis): Millis {
  const start = clock.dayStart(now);
  if (!Number.isFinite(start) || start > now) {
    throw new RangeError(`clock.dayStart(${now}) returned ${start}`);
  }
  return start;
}

function assertKey(key: ScheduleKey): void {
  if (typeof key !== 'string' || key.length === 0 || key !== key.trim()) {
    throw new RangeError('schedule key must be a non-empty, trimmed string');
  }
}

function assertEntry(entry: ScheduleEntry): void {
  assertKey(entry.key);
  if (!Number.isFinite(entry.dueAt)) {
    throw new RangeError(`dueAt must be finite, got ${entry.dueAt}`);
  }
  if (!Number.isInteger(entry.intervalDays) || entry.intervalDays < 0) {
    throw new RangeError(`intervalDays must be a non-negative integer, got ${entry.intervalDays}`);
  }
  if (!Number.isFinite(entry.ease) || entry.ease < EASE_MIN || entry.ease > EASE_MAX) {
    throw new RangeError(`ease must be in [${EASE_MIN}, ${EASE_MAX}], got ${entry.ease}`);
  }
  if (!Number.isInteger(entry.reps) || entry.reps < 0) {
    throw new RangeError(`reps must be a non-negative integer, got ${entry.reps}`);
  }
}

function clampEase(ease: number): number {
  return Math.min(EASE_MAX, Math.max(EASE_MIN, ease));
}

function compareByDue(a: ScheduleEntry, b: ScheduleEntry): number {
  if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

function compareByKey(a: ScheduleEntry, b: ScheduleEntry): number {
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

function compareAttempts(a: Attempt, b: Attempt): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * 新卡 dueAt = 当天自然日边界，因此立即进入队列；reps=0 就是新卡标识。
 * 首次出现由 replay 先 create 再 review 同一个 attempt。
 */
export function createEntry(key: ScheduleKey, now: Millis, clock: Clock): ScheduleEntry {
  assertKey(key);
  assertTime(now);
  return { key, dueAt: dayStartOf(clock, now), intervalDays: 0, ease: DEFAULT_EASE, reps: 0 };
}

export function due(entries: readonly ScheduleEntry[], now: Millis): readonly ScheduleEntry[] {
  assertTime(now);
  const seen = new Set<ScheduleKey>();
  for (const entry of entries) {
    assertEntry(entry);
    if (seen.has(entry.key)) {
      throw new RangeError(`duplicate schedule key ${entry.key}`);
    }
    seen.add(entry.key);
  }
  return entries.filter((entry) => entry.dueAt <= now).sort(compareByDue);
}

/**
 * 5 正确且 rt<=2s；4 正确；3 partial>=0.8（通过但 ease 下降）；
 * 2 partial>=0.5；1 可归因混淆；0 其他。
 */
export function gradeOf(judgement: Judgement): SrsGrade {
  const partial = judgement.partial;
  if (!Number.isFinite(partial) || partial < 0 || partial > 1) {
    throw new RangeError(`partial must be in [0, 1], got ${partial}`);
  }
  if (!Number.isFinite(judgement.rtMs) || judgement.rtMs < 0) {
    throw new RangeError(`rtMs must be non-negative, got ${judgement.rtMs}`);
  }
  if (judgement.correct !== (partial === 1)) {
    throw new RangeError('correct judgement must have partial 1');
  }

  if (judgement.correct && judgement.rtMs <= FAST_RT_MS) return 5;
  if (judgement.correct) return 4;
  if (partial >= 0.8) return 3;
  if (partial >= 0.5) return 2;
  if (judgement.confusion !== null) return 1;
  return 0;
}

/** 失败次日到期；通过时 intervalDays 不缩短，dueAt 锚定自然日边界。 */
export function review(
  entry: ScheduleEntry,
  grade: SrsGrade,
  now: Millis,
  clock: Clock,
): ScheduleEntry {
  assertEntry(entry);
  assertTime(now);
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    throw new RangeError(`grade must be an integer in [0, 5], got ${grade}`);
  }

  const today = dayStartOf(clock, now);
  const ease = clampEase(entry.ease + EASE_DELTA[grade]);
  if (grade < PASS_GRADE) {
    return { ...entry, dueAt: today + DAY_MS, intervalDays: 1, ease, reps: 0 };
  }

  const index = Math.min(entry.reps, SRS_INTERVALS_DAYS.length - 1);
  const nominal = SRS_INTERVALS_DAYS[index];
  if (nominal === undefined) {
    throw new RangeError('SRS interval ladder is empty');
  }
  const computed = Math.max(1, Math.round(nominal * (ease / DEFAULT_EASE)));
  const intervalDays = Math.max(entry.intervalDays, computed);

  return {
    ...entry,
    dueAt: today + intervalDays * DAY_MS,
    intervalDays,
    ease,
    reps: entry.reps + 1,
  };
}

/**
 * 按 (at, id) 全序重放。reviewKeys 是 attempt 的题目侧快照：
 * 每个 key 首次出现先 create，再用同一个 attempt 的 grade 立即 review。
 */
export function replay(attempts: readonly Attempt[], clock: Clock): readonly ScheduleEntry[] {
  const sorted = [...attempts].sort(compareAttempts);
  const seenAttempts = new Set<string>();
  const entries = new Map<ScheduleKey, ScheduleEntry>();

  for (const attempt of sorted) {
    const schema = attempt.schemaVersion as number;
    if (schema !== 1 && schema !== 2) {
      throw new RangeError(`unsupported attempt schema ${attempt.schemaVersion}`);
    }
    if (seenAttempts.has(attempt.id)) {
      throw new RangeError(`duplicate attempt id ${attempt.id}`);
    }
    seenAttempts.add(attempt.id);
    if (!Number.isFinite(attempt.at)) {
      throw new RangeError(`attempt time must be finite, got ${attempt.at}`);
    }
    if (attempt.context === 'focus') {
      continue;
    }

    const keys = Array.isArray(attempt.reviewKeys)
      ? attempt.reviewKeys
      : schema === 1
        ? [attempt.skill]
        : null;
    if (keys === null) {
      throw new RangeError('v2 attempt reviewKeys must be an array');
    }
    if (!keys.includes(attempt.skill)) {
      throw new RangeError(`reviewKeys must include attempt.skill ${attempt.skill}`);
    }

    const grade = gradeOf(attempt.judgement);
    const seenKeys = new Set<ScheduleKey>();
    for (const key of keys) {
      if (seenKeys.has(key)) {
        throw new RangeError(`duplicate review key ${key}`);
      }
      seenKeys.add(key);

      const entry = entries.get(key) ?? createEntry(key, attempt.at, clock);
      entries.set(key, review(entry, grade, attempt.at, clock));
    }
  }

  return [...entries.values()].sort(compareByKey);
}
