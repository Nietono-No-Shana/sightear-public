import { readFileSync } from 'node:fs';
import { lessonForContent, parseContentPack, validateScoreGenerator, EXERCISE_EXAMPLES, INITIAL_PRACTICE_SPECS } from '@engine/config';
import { generateScore } from '@engine/items';
import { scoreTimeline } from '@engine/theory';
import { contentPilotCases, createPilotStore } from '../src/store/pilot';
import type { Response, ScoreGeneratorSpec, Attempt, Clock } from '@engine/ports';
import { makeRng, makeRngFactory } from './support/rng';

const pack = parseContentPack(JSON.parse(readFileSync('content/packs/authoring-v3-sample.json', 'utf8')));
const example = pack.lessons[2]!.spec;
if (!('kind' in example) || !('scores' in example) || !example.generator) throw new Error('missing generator fixture');
const generator = example.generator;
const clock: Clock = { now: () => 0, dayStart: () => 0 };

describe('content authoring contract', () => {
  it('supports half-note meters and 32nd notes without bypassing capture duration limits', () => {
    const rhythm: ScoreGeneratorSpec = { kind: 'rhythm-grid', version: 3, clef: 'treble',
      key: { tonic: 0, mode: 'major', fifths: 0 }, time: { beats: 2, unit: 2 }, measures: 1,
      durations: [{ value: 32, dots: 0 }], restProbability: 0 };
    const score = generateScore(rhythm, makeRng(42));
    expect(scoreTimeline(score, 60).notes).toHaveLength(32);
    expect(() => validateScoreGenerator(rhythm, 'rhythm-reading', 7500 / 90)).not.toThrow();
    expect(() => validateScoreGenerator(rhythm, 'rhythm-reading', 84)).toThrow(/90ms/);
    expect(() => validateScoreGenerator(rhythm, 'rhythm-dictation', 120)).not.toThrow();
    expect(() => validateScoreGenerator({ ...rhythm, version: 2 }, 'rhythm-reading', 60)).toThrow();
  });

  it('requires named patterns, feature counts and melodic endpoints for every sampled seed', () => {
    const before = JSON.stringify(generator);
    for (let seed = 0; seed < 128; seed += 1) {
      const score = generateScore(generator, makeRng(seed));
      expect(generateScore(generator, makeRng(seed))).toEqual(score);
      const notes = score.measures.flatMap((measure) => measure.voices[0]!.notes);
      const timeline = scoreTimeline(score, 90);
      expect(notes.filter((note) => note.duration.dots === 1).length).toBeGreaterThanOrEqual(2);
      expect(notes.filter((note) => note.duration.tuplet).length).toBeGreaterThanOrEqual(3);
      expect(score.measures.slice(0, -1).some((measure) => measure.voices[0]!.notes.at(-1)!.tie)).toBe(true);
      expect(timeline.notes[0]!.midi % 12).toBe(9);
      expect(timeline.notes.at(-1)!.midi % 12).toBe(9);
      expect(timeline.notes.every((note) => [9, 11, 0, 2, 4, 5, 8].includes(note.midi % 12))).toBe(true);
      expect(notes.every((note) => !note.pitch || note.pitch.midi % 12 !== 8 || note.pitch.name.startsWith('G#'))).toBe(true);
      expect(timeline.notes.slice(1).every((note, index) => note.midi !== timeline.notes[index]!.midi && Math.abs(note.midi - timeline.notes[index]!.midi) <= 5)).toBe(true);
    }
    expect(JSON.stringify(generator)).toBe(before);
  });

  it('supports pattern-only lessons and fails closed on impossible endpoint or feature requirements', () => {
    expect(() => generateScore({ ...generator, durations: [] }, makeRng(5))).not.toThrow();
    expect(() => generateScore({ ...generator, required: { acrossMeasureTies: 4 } }, makeRng(0))).toThrow(/impossible/);
    expect(() => generateScore({ ...generator, patterns: [{ id: 'bad', minOccurrences: 1, notes: [
      { rest: false, duration: { value: 8, dots: 0, tuplet: { actual: 3, normal: 2 } } },
    ] }] }, makeRng(0))).toThrow(/complete triplet/);
    const impossible: ScoreGeneratorSpec = { ...generator, kind: 'diatonic-melody', pitchRange: [57, 57], maxLeapSemitones: 5,
      melody: { scale: 'harmonicMinor', degrees: [1, 2], startDegrees: [2], endDegrees: [1], allowRepeatedNotes: true } };
    expect(() => generateScore(impossible, makeRng(0))).toThrow(/128 attempts/);
  });

  it('imports all 14 types into real pilot sessions without global spec registration', async () => {
    const specs = [...pack.lessons.slice(0, 2).map((entry) => entry.spec),
      ...['chord-inversion', 'interval-comparison', 'scale-identification'].map((kind) => INITIAL_PRACTICE_SPECS.find((spec) => spec.task.kind === kind)!),
      ...EXERCISE_EXAMPLES];
    expect(specs).toHaveLength(14);
    for (const [index, source] of specs.entries()) {
      const id = `handoff.${index}`;
      const spec = { ...source, id, questionCount: 2 };
      const content = { ...pack, packId: 'test.handoff', lessons: [{ id, order: 1, source: pack.lessons[0]!.source, spec }] };
      const cases = contentPilotCases(content, 42);
      expect(() => lessonForContent(parseContentPack(content).lessons[0]!)).not.toThrow();
      const attempts: Attempt[] = [];
      const storage = { loadAll: async () => [], append: async (attempt: Attempt) => { attempts.push(attempt); }, exportJson: async () => '[]' };
      const store = await createPilotStore(storage, clock, makeRngFactory(), 'piano');
      let item = store.startCase(cases[0]!);
      const first = item;
      for (let question = 0; question < 2; question += 1) {
        const key = item.key;
        let response: Response;
        if (key.type === 'choice') response = { kind: 'choice', index: key.index, rtMs: 100 };
        else if (key.type === 'functions') response = { kind: 'functions', symbols: [...key.symbols], rtMs: 100 };
        else if (key.type === 'locations') response = { kind: 'locations', indices: [...key.indices], rtMs: 100 };
        else if (key.type !== 'performance') throw new Error('unexpected answer type');
        else if (key.mode === 'notation') response = { kind: 'notation', score: item.answerScore!, rtMs: 100 };
        else if (key.mode === 'tapped') response = { kind: 'tapped', onsets: key.notes.map((note) => note.start), rtMs: 100 };
        else response = { kind: 'sung', notes: [...key.notes], rtMs: 100 };
        expect((await store.commit(response)).correct).toBe(true);
        const next = store.next();
        if (question === 0) { expect(next).not.toBeNull(); item = next!; }
        else expect(next).toBeNull();
      }
      expect(attempts).toHaveLength(2);
      expect(store.startCase(cases[0]!)).toEqual(first);
    }
  });

  it('rejects invented fields and choice codes rather than silently ignoring them', () => {
    const mutate = (change: Record<string, unknown>) => ({ ...pack, lessons: [{ ...pack.lessons[0]!, spec: { ...pack.lessons[0]!.spec, ...change } }] });
    expect(() => parseContentPack(mutate({ task: { kind: 'interval-identification', codes: ['m3', 'made-up'] } }))).toThrow();
    expect(() => parseContentPack(mutate({ task: { kind: 'interval-identification', codes: ['m3', 'M3'], extra: 1 } }))).toThrow(/unsupported/);
    expect(() => contentPilotCases(pack, -1)).toThrow(/seed/);
  });
});
