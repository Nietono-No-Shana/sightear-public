import { replay as replayAbility } from '@engine/ability';
import { STD_CHORD_COURSE, STD_INTERVAL_COURSE, TRIAD_INVERSION_COURSE, SCALE_IDENTIFICATION_COURSE, INTERVAL_COMPARISON_COURSE, INITIAL_PRACTICE_SPECS, practiceAnswerCodes, getSkill, SKILLS, COURSE_SKILLS, practiceSpecForLesson, templateRating } from '@engine/config';
import type { Attempt, Clock, PracticeRequest, RngFactory } from '@engine/ports';
import { replay as replaySchedule } from '@engine/schedule';
import { judge } from '@engine/scoring';
import type { NextItem } from '@engine/selection';
import { commit, createSession, nextItem } from '@engine/session';
import { makeRng, makeRngFactory } from './support/rng';

const DAY_MS = 86_400_000;
const ANCHOR = 14_400_000;
const START = 3 * DAY_MS + ANCHOR - 2_000;
const factory = makeRngFactory();
const clock: Clock = {
  now: () => { throw new Error('use the supplied timestamp'); },
  dayStart: (time) => Math.floor((time - ANCHOR) / DAY_MS) * DAY_MS + ANCHOR,
};
const daily: PracticeRequest = { mode: 'daily', scope: 'mixed', limit: 12 };
const requests: readonly PracticeRequest[] = [
  daily,
  ...INTERVAL_COMPARISON_COURSE.modules.flatMap((module) => module.lessons.map((entry): PracticeRequest => ({
    mode: 'focus', scope: 'interval', lesson: entry.lesson!, limit: entry.questionCount ?? 12,
  }))),
  ...SCALE_IDENTIFICATION_COURSE.modules.flatMap((module) => module.lessons.map((entry): PracticeRequest => ({
    mode: 'focus', scope: 'scale', lesson: entry.lesson!, limit: entry.questionCount ?? 12,
  }))),
  ...TRIAD_INVERSION_COURSE.modules.flatMap((module) => module.lessons.map((entry): PracticeRequest => {
    if (!entry.lesson) throw new Error('missing inversion lesson');
    return { mode: 'focus', scope: 'chord', lesson: entry.lesson, limit: entry.questionCount ?? 12 };
  })),
  { mode: 'focus', scope: 'interval', limit: 12, focus: { kind: 'pair', pair: 'm3:M3', reason: 'fixture' } },
  ...[TRIAD_INVERSION_COURSE, SCALE_IDENTIFICATION_COURSE].map((course): PracticeRequest => {
    const lesson = course.modules[0]?.lessons[0]?.lesson;
    if (!lesson) throw new Error('missing fixture lesson');
    return { mode: 'focus', scope: lesson.module, lesson, limit: 12 };
  }),
];

function requireItem(item: NextItem | null): NextItem {
  if (!item) throw new Error('expected an item');
  return item;
}

function fixtureJudgement(item: NextItem, index: number) {
  if (item.key.type !== 'choice' || !item.presented.options) throw new Error('expected a choice');
  return judge(item.presented, item.key, {
    kind: 'choice',
    index: (item.key.index + (index % 3 === 0 ? 1 : 0)) % item.presented.options.length,
    rtMs: index % 2 === 0 ? 2_000 : 2_001,
  });
}

function runFixture(request: PracticeRequest, seed: number, history: readonly Attempt[] = [], start = START) {
  let state = createSession(history, start, request, clock);
  const rng = makeRng(seed);
  const items: NextItem[] = [];
  for (let index = 0; index < 12; index += 1) {
    const item = requireItem(nextItem(state, start + index * 1_000, rng, factory));
    const before = JSON.stringify(state);
    const result = commit(state, item, fixtureJudgement(item, index), start + index * 1_000 + 500, clock);
    expect(JSON.stringify(state)).toBe(before);
    expect(result.attempt).toMatchObject({
      itemId: item.presented.id, templateKey: item.presented.templateKey,
      itemRating: item.itemRating, predictedP: item.predictedP, schemaVersion: 2,
    });
    expect(result.attempt.reviewKeys).toContain(item.presented.skill);
    expect(new Set(result.attempt.reviewKeys).size).toBe(result.attempt.reviewKeys.length);
    state = result.state;
    items.push(item);
  }
  expect(nextItem(state, start + 12_000, rng, factory)).toBeNull();
  return { state, items };
}

describe('complete session regression', () => {
  it('keeps course-only skills out of the legacy daily pool', () => {
    expect(SKILLS).toHaveLength(49);
    expect(COURSE_SKILLS).toHaveLength(6);
    for (const skill of COURSE_SKILLS) {
      expect(SKILLS.some((entry) => entry.id === skill.id)).toBe(false);
      expect(getSkill(skill.id)).toEqual(skill);
    }
  });

  it.each(TRIAD_INVERSION_COURSE.modules.flatMap((module) => module.lessons))('honors the full inversion specification for $id', (entry) => {
    if (!entry.lesson) throw new Error('missing lesson');
    const spec = practiceSpecForLesson(entry.lesson);
    if (!spec) throw new Error('missing spec');
    expect(entry.questionCount).toBe(12);
    const request: PracticeRequest = { mode: 'focus', scope: 'chord', lesson: entry.lesson, limit: entry.questionCount ?? 12 };
    const result = runFixture(request, 41);
    expect(result.items).toHaveLength(12);
    for (const item of result.items) {
      const meta = getSkill(item.presented.skill);
      if (meta.kind !== 'chord-inversion') throw new Error('wrong skill kind');
      expect(item.presented.features).toMatchObject({ tempoBpm: 90, direction: 'harmonic', reference: 'none', register: 'low' });
      expect(item.itemRating).toBe(templateRating(meta.id, item.presented.features));
      expect(item.presented.options?.slice().sort()).toEqual([...practiceAnswerCodes(spec.task)].sort());
      expect(item.presented.templateKey).toContain(`${spec.id}@1`);
      const toneCount = ['major', 'minor', 'diminished'].includes(meta.quality) ? 3 : 4;
      if (toneCount === 3) expect(item.presented.targets.join(',')).not.toContain('third');
      expect(item.presented.stimulus).toHaveLength(1);
      const sound = item.presented.stimulus?.[0];
      if (sound?.kind !== 'chord') throw new Error('expected a simultaneous chord');
      expect(sound.midis).toHaveLength(toneCount);
      expect(sound.start).toBe(0);
      expect(sound.dur).toBe(1200);
      const rootIndex = meta.inversion === 0 ? 0 : toneCount - meta.inversion;
      const root = sound.midis[rootIndex]! - (meta.inversion === 0 ? 0 : 12);
      expect(root).toBeGreaterThanOrEqual(48);
      expect(root).toBeLessThanOrEqual(59);
    }
  });

  it('rejects missing or mismatched practice specifications before starting', () => {
    const lesson = TRIAD_INVERSION_COURSE.modules[0]!.lessons[0]!.lesson!;
    for (const practiceSpecId of ['missing']) {
      expect(() => createSession([], START, { ...daily, lesson: { ...lesson, practiceSpecId } }, clock)).toThrow('not playable');
    }
    expect(() => practiceSpecForLesson({ ...lesson, skills: [] })).toThrow('does not match');
    expect(() => practiceSpecForLesson({ ...lesson, practiceSpecId: INITIAL_PRACTICE_SPECS[10]!.id })).toThrow('does not match');
    expect(practiceSpecForLesson(undefined)).toBeUndefined();
  });

  it.each(requests)('reproduces a full request and replays every recorded answer: %j', (request) => {
    const result = runFixture(request, 203);
    expect(JSON.stringify(runFixture(request, 203))).toBe(JSON.stringify(result));
    const recorded: Attempt[] = JSON.parse(JSON.stringify(result.state.attempts));
    let replayed = createSession([], START, request, clock);
    const rng = makeRng(203);
    for (const [index, attempt] of recorded.entries()) {
      const item = requireItem(nextItem(replayed, START + index * 1_000, rng, factory));
      expect(item).toEqual(result.items[index]);
      const committed = commit(replayed, item, attempt.judgement, attempt.at, clock);
      expect(committed.attempt).toEqual(attempt);
      replayed = committed.state;
    }
    expect(replayed).toEqual(result.state);
    expect(replayed.snapshot.ability).toEqual(replayAbility(recorded));
    expect(replayed.snapshot.schedule).toEqual(replaySchedule(recorded, clock));
    expect(createSession([...recorded].reverse(), START + DAY_MS, request, clock).snapshot).toEqual(replayed.snapshot);
    for (const entry of replayed.snapshot.schedule) {
      expect(clock.dayStart(entry.dueAt)).toBe(entry.dueAt);
    }
  });

  it('reproduces the next round from serialized history without losing prior snapshots', () => {
    const history = runFixture(daily, 11).state.attempts;
    const before = JSON.stringify(history);
    const restored: Attempt[] = JSON.parse(before);
    const nextRound = runFixture(daily, 31, history, START + DAY_MS);
    expect(runFixture(daily, 31, restored, START + DAY_MS)).toEqual(nextRound);
    expect(JSON.stringify(history)).toBe(before);
    expect(new Set(nextRound.state.attempts.map((attempt) => attempt.id)).size).toBe(24);
  });

  it('fails generation once without retrying or committing a partial answer', () => {
    const state = createSession([], START, daily, clock);
    const before = JSON.stringify(state);
    const fromSeed = vi.fn<RngFactory['fromSeed']>(() => { throw new Error('generation failed'); });
    expect(() => nextItem(state, START, makeRng(17), { fromSeed })).toThrow('generation failed');
    expect(fromSeed).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(state)).toBe(before);
    expect(state.attempts).toHaveLength(0);
    expect(requireItem(nextItem(state, START, makeRng(17), factory)).presented.seed).toBe(fromSeed.mock.calls[0]?.[0]);
  });

  it('does not consume random numbers or generate after the lesson limit', () => {
    const state = runFixture(daily, 5).state;
    const rng = makeRng(7);
    const int = vi.spyOn(rng, 'int');
    const fromSeed: RngFactory['fromSeed'] = vi.fn(() => { throw new Error('must not generate'); });
    expect(nextItem(state, START + 12_000, rng, { fromSeed })).toBeNull();
    expect(int).not.toHaveBeenCalled();
    expect(fromSeed).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -Infinity, -0.01, 1.01])('rejects invalid probability snapshots: %s', (predictedP) => {
    const state = createSession([], START, daily, clock);
    const item = requireItem(nextItem(state, START, makeRng(1), factory));
    expect(() => commit(state, { ...item, predictedP }, fixtureJudgement(item, 1), START, clock)).toThrow('predictedP');
    expect(state.attempts).toHaveLength(0);
  });

  it.each(['', '   '])('rejects missing template snapshots: %j', (templateKey) => {
    const state = createSession([], START, daily, clock);
    const item = requireItem(nextItem(state, START, makeRng(1), factory));
    const invalid = { ...item, presented: { ...item.presented, templateKey } };
    expect(() => commit(state, invalid, fixtureJudgement(item, 1), START, clock)).toThrow('templateKey');
  });

  it.each([0, 1])('retains a valid probability endpoint: %s', (predictedP) => {
    const state = createSession([], START, daily, clock);
    const item = requireItem(nextItem(state, START, makeRng(1), factory));
    const result = commit(state, { ...item, predictedP }, fixtureJudgement(item, 1), START, clock);
    expect(result.attempt.predictedP).toBe(predictedP);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite difficulty snapshots: %s', (itemRating) => {
    const state = createSession([], START, daily, clock);
    const item = requireItem(nextItem(state, START, makeRng(1), factory));
    expect(() => commit(state, { ...item, itemRating }, fixtureJudgement(item, 1), START, clock)).toThrow('itemRating');
  });
});
