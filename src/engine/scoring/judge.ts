import type { AnswerKey, Judgement, PresentedItem, Response } from '../ports';
import { confusionKey } from '../config';
import { judgePerformance } from './performance';
import { judgeStructured } from './structured';

export function judge(
  presented: PresentedItem,
  key: AnswerKey,
  response: Response,
): Judgement {
  if (!Number.isFinite(response.rtMs) || response.rtMs < 0) throw new RangeError('invalid response time');
  if (key.type === 'performance') return judgePerformance(key, response);
  if (key.type === 'functions' || key.type === 'locations') return judgeStructured(key, response);
  if (key.type !== 'choice') {
    throw new RangeError(`unsupported answer contract ${key.type}`);
  }
  if (response.kind !== 'choice') {
    throw new RangeError(`choice response required, got ${response.kind}`);
  }
  const options = presented.options;
  if (options === null) {
    throw new RangeError('choice item must have options');
  }
  if (!Number.isInteger(key.index) || key.index < 0 || key.index >= options.length) {
    throw new RangeError(`answer index ${key.index} is out of range`);
  }
  if (
    !Number.isInteger(response.index) ||
    response.index < 0 ||
    response.index >= options.length
  ) {
    throw new RangeError(`response index ${response.index} is out of range`);
  }
  if (!Number.isFinite(response.rtMs) || response.rtMs < 0) {
    throw new RangeError(`rtMs must be non-negative, got ${response.rtMs}`);
  }

  const actual = options[key.index];
  const picked = options[response.index];
  if (actual === undefined || picked === undefined) {
    throw new RangeError('choice option is missing');
  }

  const correct = response.index === key.index;
  return {
    correct,
    partial: correct ? 1 : 0,
    errorType: correct ? 'none' : 'pitch',
    confusion: correct ? null : confusionKey(actual, picked),
    cents: null,
    rtMs: response.rtMs,
  };
}
