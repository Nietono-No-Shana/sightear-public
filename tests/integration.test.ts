import { initial, predictSuccess, replay as replayAbility } from '@engine/ability';
import { templateRating } from '@engine/config';
import { generate } from '@engine/items';
import { replay as replaySchedule } from '@engine/schedule';
import { judge } from '@engine/scoring';
import type { AnswerKey, Attempt, Clock, ItemFeatures, ScheduleKey, SkillId } from '@engine/ports';
import { makeRngFactory } from './support/rng';

const skill: SkillId = 'interval.identify.m3';
const factory = makeRngFactory();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const ANCHOR = 4 * HOUR_MS;

const clock: Clock = {
  now: () => 0,
  dayStart: (t: number) => Math.floor((t - ANCHOR) / DAY_MS) * DAY_MS + ANCHOR,
};

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

describe('generate → judge → Attempt → replay', () => {
  it('keeps the attempt snapshot replayable by ability and schedule', () => {
    const item = generate(skill, features, 31, factory);
    const key = choiceKey(item);
    const judgement = judge(item.presented, key, {
      kind: 'choice',
      index: key.index,
      rtMs: 900,
    });

    const itemRating = templateRating(skill, features);
    const before = initial(skill, 1000, 0);
    const predictedP = predictSuccess(before, itemRating);

    const attempt: Attempt = {
      id: 'attempt-1',
      itemId: item.presented.id,
      templateKey: item.templateKey,
      skill,
      itemRating,
      predictedP,
      reviewKeys: item.targets,
      at: 0,
      judgement,
      schemaVersion: 2,
    };

    expect(attempt.reviewKeys).toContain(skill);
    expect(attempt.predictedP).toBeGreaterThanOrEqual(0);
    expect(attempt.predictedP).toBeLessThanOrEqual(1);
    expect(attempt.itemRating).toBe(templateRating(skill, features));

    const abilities = replayAbility([attempt]);
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.n).toBe(1);
    expect(abilities[0]?.rating).toBeGreaterThan(1000);

    const entries = replaySchedule([attempt], clock);
    expect(entries.map((entry) => entry.key)).toContain(skill);
    expect(entries.every((entry) => entry.reps === 1)).toBe(true);
  });

  it('puts a wrong-answer confusion into reviewKeys and fails that pair', () => {
    const item = generate(skill, features, 32, factory);
    const key = choiceKey(item);
    const options = item.presented.options;
    if (options === null) throw new Error('expected options');

    const wrong = options.indexOf('M3');
    if (wrong < 0 || wrong === key.index) throw new Error('expected a wrong M3 option');

    const judgement = judge(item.presented, key, {
      kind: 'choice',
      index: wrong,
      rtMs: 1_200,
    });
    const confusion = judgement.confusion;
    if (confusion === null) throw new Error('expected a confusion pair');

    const itemRating = templateRating(skill, features);
    const before = initial(skill, 1000, 0);
    const reviewKeys = [...new Set<ScheduleKey>([skill, ...item.targets, confusion])];
    const attempt: Attempt = {
      id: 'attempt-wrong',
      itemId: item.presented.id,
      templateKey: item.templateKey,
      skill,
      itemRating,
      predictedP: predictSuccess(before, itemRating),
      reviewKeys,
      at: 0,
      judgement,
      schemaVersion: 2,
    };

    expect(attempt.reviewKeys).toContain(skill);
    expect(attempt.reviewKeys).toContain(confusion);

    const entries = replaySchedule([attempt], clock);
    const pair = entries.find((entry) => entry.key === confusion);
    const skillEntry = entries.find((entry) => entry.key === skill);

    expect(pair?.reps).toBe(0);
    expect(pair?.intervalDays).toBe(1);
    expect(skillEntry?.reps).toBe(0);
    expect(skillEntry?.intervalDays).toBe(1);
  });
});
