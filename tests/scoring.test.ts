import { scoreOf } from '@engine/ability';
import { confusionKey } from '@engine/config';
import { generate } from '@engine/items';
import { gradeOf } from '@engine/schedule';
import { judge } from '@engine/scoring';
import type { AnswerKey, ItemFeatures, Response } from '@engine/ports';
import { makeRngFactory } from './support/rng';

const factory = makeRngFactory();

const features: ItemFeatures = {
  register: 'mid',
  direction: 'asc',
  reference: 'none',
  timbre: 'piano',
  tempoBpm: 120,
  voices: 1,
  bars: 1,
  chunk: 1,
};

function choiceKey(item: ReturnType<typeof generate>): Extract<AnswerKey, { type: 'choice' }> {
  if (item.key.type !== 'choice') throw new Error('expected choice key');
  return item.key;
}

describe('judge', () => {
  it.each([NaN, Infinity, -Infinity, -1, 0.5])('rejects invalid response indices: %s', (index) => {
    const item = generate('interval.identify.m3', features, 21, factory);
    expect(() => judge(item.presented, choiceKey(item), { kind: 'choice', index, rtMs: 1 })).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid response times: %s', (rtMs) => {
    const item = generate('interval.identify.m3', features, 21, factory);
    const key = choiceKey(item);
    expect(() => judge(item.presented, key, { kind: 'choice', index: key.index, rtMs })).toThrow(RangeError);
  });

  it('grades a correct choice and feeds score/grade', () => {
    const item = generate('interval.identify.m3', features, 21, factory);
    const key = choiceKey(item);
    const response: Response = { kind: 'choice', index: key.index, rtMs: 900 };

    const result = judge(item.presented, key, response);

    expect(result).toEqual({
      correct: true,
      partial: 1,
      errorType: 'none',
      confusion: null,
      cents: null,
      rtMs: 900,
    });
    expect(scoreOf(result)).toBe(1);
    expect(gradeOf(result)).toBe(5);
  });

  it('records a canonical confusion pair for a wrong choice', () => {
    const item = generate('interval.identify.m3', features, 22, factory);
    const key = choiceKey(item);
    const options = item.presented.options;
    if (options === null) throw new Error('expected options');

    const wrong = (key.index + 1) % options.length;
    const result = judge(item.presented, key, { kind: 'choice', index: wrong, rtMs: 1_200 });
    const actual = options[key.index];
    const picked = options[wrong];
    if (actual === undefined || picked === undefined) throw new Error('missing option');

    expect(result.correct).toBe(false);
    expect(result.partial).toBe(0);
    expect(result.errorType).toBe('pitch');
    expect(result.confusion).toBe(confusionKey(actual, picked));
    expect(scoreOf(result)).toBe(0);
    expect(gradeOf(result)).toBe(1);
  });

  it('applies the RT grade table to fast and slow correct answers', () => {
    const item = generate('chord.identify.maj', features, 23, factory);
    const key = choiceKey(item);
    const slow = judge(item.presented, key, { kind: 'choice', index: key.index, rtMs: 2_001 });

    expect(gradeOf(slow)).toBe(4);
  });

  it('rejects non-choice inputs and out-of-range indices', () => {
    const item = generate('interval.identify.m3', features, 24, factory);
    const key = choiceKey(item);

    expect(() =>
      judge(item.presented, { type: 'notes', notes: [] }, {
        kind: 'choice',
        index: 0,
        rtMs: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      judge(item.presented, key, { kind: 'tapped', onsets: [], rtMs: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      judge(item.presented, key, { kind: 'choice', index: 99, rtMs: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      judge(item.presented, key, { kind: 'choice', index: key.index, rtMs: -1 }),
    ).toThrow(RangeError);
  });
});
