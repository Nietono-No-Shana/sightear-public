import type { AnswerKey, Judgement, NoteDifference, Response } from '../ports';

export function judgeStructured(key: Extract<AnswerKey, { type: 'functions' | 'locations' }>, response: Response): Judgement {
  const details: NoteDifference[] = [];
  let denominator = 0;
  let correctCount = 0;
  if (key.type === 'functions' && response.kind === 'functions') {
    if (!key.symbols.length || response.symbols.length > 64 || response.symbols.some((symbol) => typeof symbol !== 'string' || !symbol.trim())) throw new RangeError('invalid function response');
    denominator = Math.max(key.symbols.length, response.symbols.length);
    for (let index = 0; index < denominator; index += 1) {
      const expected = key.symbols[index];
      const actual = response.symbols[index];
      const errors = expected === actual ? [] : [expected === undefined ? 'extra' as const : actual === undefined ? 'omission' as const : 'function' as const];
      if (!errors.length) correctCount += 1;
      details.push({ expectedIndex: expected === undefined ? null : index, responseIndex: actual === undefined ? null : index,
        errors, cents: null, onsetErrorMs: null, durationErrorMs: null });
    }
  } else if (key.type === 'locations' && response.kind === 'locations') {
    for (const indices of [key.indices, response.indices]) {
      if (new Set(indices).size !== indices.length || indices.some((index) => !Number.isInteger(index) || index < 0 || index >= key.size)) throw new RangeError('invalid correction location');
    }
    if (!key.indices.length || !Number.isInteger(key.size) || key.size <= 0) throw new RangeError('invalid correction answer');
    const union = [...new Set([...key.indices, ...response.indices])];
    denominator = union.length;
    for (const index of union) {
      const expected = key.indices.includes(index);
      const actual = response.indices.includes(index);
      if (expected && actual) correctCount += 1;
      details.push({ expectedIndex: expected ? index : null, responseIndex: actual ? index : null,
        errors: expected && actual ? [] : [expected ? 'omission' : 'extra'], cents: null, onsetErrorMs: null, durationErrorMs: null });
    }
  } else throw new RangeError('response does not match structured task');
  const correct = correctCount === denominator;
  return { correct, partial: correctCount / denominator, errorType: details.flatMap((detail) => detail.errors)[0] ?? 'none',
    confusion: null, cents: null, rtMs: response.rtMs, details };
}
