import type {
  AbilityState,
  Attempt,
  Judgement,
  Millis,
  SkillId,
  SuccessPrediction,
} from '../ports';

const K_BASE = 32;
const K_FLOOR = 4;
const K_SCALE = 32;

export const DEFAULT_RATING = 1200;

function assertTime(now: Millis): void {
  if (!Number.isFinite(now)) {
    throw new RangeError(`time must be a finite number, got ${now}`);
  }
}

function assertState(state: AbilityState): void {
  if (typeof state.skill !== 'string' || state.skill.length === 0) {
    throw new RangeError('skill must be a non-empty string');
  }
  if (!Number.isFinite(state.rating)) {
    throw new RangeError(`rating must be finite, got ${state.rating}`);
  }
  if (!Number.isInteger(state.n) || state.n < 0) {
    throw new RangeError(`attempt count must be a non-negative integer, got ${state.n}`);
  }
  if (!Number.isFinite(state.updatedAt)) {
    throw new RangeError(`updatedAt must be finite, got ${state.updatedAt}`);
  }
}

function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** K 随作答数衰减，保留地板值。 */
export function kFactor(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`attempt count must be a non-negative integer, got ${n}`);
  }
  return Math.max(K_FLOOR, K_BASE / (1 + n / K_SCALE));
}

/** 唯一的产品接口：给定当前能力状态与题目难度 b，返回预测成功率 p。 */
export function predictSuccess(
  state: AbilityState,
  itemRating: number,
): SuccessPrediction {
  assertState(state);
  if (!Number.isFinite(itemRating)) {
    throw new RangeError(`item rating must be finite, got ${itemRating}`);
  }
  return expected(state.rating, itemRating);
}

/** score 取 [0, 1]，允许部分分；二元判定传 0 或 1。 */
export function updateAbility(
  state: AbilityState,
  itemRating: number,
  score: number,
  now: Millis,
): AbilityState {
  assertState(state);
  if (!Number.isFinite(itemRating)) {
    throw new RangeError(`item rating must be finite, got ${itemRating}`);
  }
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError(`score must be in [0, 1], got ${score}`);
  }
  assertTime(now);

  const delta = kFactor(state.n) * (score - predictSuccess(state, itemRating));
  return { ...state, rating: state.rating + delta, n: state.n + 1, updatedAt: now };
}

/** 只有满分才算 correct；partial 与 correct 不一致属于 scoring bug。 */
export function scoreOf(judgement: Judgement): number {
  const partial = judgement.partial;
  if (!Number.isFinite(partial) || partial < 0 || partial > 1) {
    throw new RangeError(`partial must be in [0, 1], got ${partial}`);
  }
  if (judgement.correct !== (partial === 1)) {
    throw new RangeError('correct judgement must have partial 1');
  }
  return partial;
}

export function initial(skill: SkillId, rating: number, now: Millis): AbilityState {
  if (typeof skill !== 'string' || skill.length === 0) {
    throw new RangeError('skill must be a non-empty string');
  }
  if (!Number.isFinite(rating)) {
    throw new RangeError(`rating must be finite, got ${rating}`);
  }
  assertTime(now);
  return { skill, rating, n: 0, updatedAt: now };
}

function compareAttempts(a: Attempt, b: Attempt): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function compareSkills(a: AbilityState, b: AbilityState): number {
  if (a.skill === b.skill) return 0;
  return a.skill < b.skill ? -1 : 1;
}

/**
 * 按 (at, id) 全序重放。v1 attempt 没有 itemRating 时用 fallbackItemRating，
 * 让旧数据可以只降级重放 ability；v2 缺字段则直接报错。
 */
export function replay(
  attempts: readonly Attempt[],
  initialRating: number = DEFAULT_RATING,
  fallbackItemRating: number = initialRating,
): readonly AbilityState[] {
  if (!Number.isFinite(initialRating) || !Number.isFinite(fallbackItemRating)) {
    throw new RangeError('replay ratings must be finite');
  }

  const sorted = [...attempts].sort(compareAttempts);
  const seen = new Set<string>();
  const states = new Map<SkillId, AbilityState>();

  for (const attempt of sorted) {
    const schema = attempt.schemaVersion as number;
    if (schema !== 1 && schema !== 2) {
      throw new RangeError(`unsupported attempt schema ${attempt.schemaVersion}`);
    }
    if (seen.has(attempt.id)) {
      throw new RangeError(`duplicate attempt id ${attempt.id}`);
    }
    seen.add(attempt.id);
    if (!Number.isFinite(attempt.at)) {
      throw new RangeError(`attempt time must be finite, got ${attempt.at}`);
    }

    let itemRating = attempt.itemRating;
    if (!Number.isFinite(itemRating)) {
      if (schema === 1) {
        itemRating = fallbackItemRating;
      } else {
        throw new RangeError(`attempt itemRating must be finite, got ${attempt.itemRating}`);
      }
    }

    const current =
      states.get(attempt.skill) ?? initial(attempt.skill, initialRating, attempt.at);
    states.set(
      attempt.skill,
      updateAbility(current, itemRating, scoreOf(attempt.judgement), attempt.at),
    );
  }

  return [...states.values()].sort(compareSkills);
}
