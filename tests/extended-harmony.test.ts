import { readFileSync } from 'node:fs';
import { parseContentPack, validatePracticeSpec, resolveHarmonyStep } from '@engine/config';
import { auditContentLesson } from '@engine/items';
import { buildChord, parsePitchName, voiceChord } from '@engine/theory';
import { contentPilotCases, createPilotStore } from '../src/store/pilot';
import { makeRngFactory } from './support/rng';
import type { Attempt, ChoicePracticeSpec } from '@engine/ports';

const root = parsePitchName('C4')!;
const pack = parseContentPack(JSON.parse(readFileSync('content/packs/extended-harmony-sample.json', 'utf8')));
const choice = pack.lessons[0]!.spec as ChoicePracticeSpec;

it('spells compound altered tones by degree instead of enharmonic pitch class', () => {
  expect(buildChord(root, 'dominant7Sharp9').map((tone) => tone.name)).toEqual(['C4', 'E4', 'G4', 'Bb4', 'D#5']);
  expect(buildChord(parsePitchName('F#3')!, 'major9Sharp11').map((tone) => tone.name)).toEqual(['F#3', 'A#3', 'C#4', 'E#4', 'G#4', 'B#4']);
  expect(buildChord(root, 'dominant13').map((tone) => tone.midi - 60)).toEqual([0, 4, 7, 10, 14, 17, 21]);
});

it('keeps the selected bass lowest, preserves spelling and rejects destructive omissions', () => {
  const voicing = { bassDegree: 3, omitDegrees: [5, 11], spread: 'open' as const };
  const before = JSON.stringify(voicing);
  const tones = voiceChord(root, 'dominant13', voicing);
  expect(tones[0]!.name).toBe('E4');
  expect(tones.map((tone) => tone.midi)).toEqual([...tones.map((tone) => tone.midi)].sort((left, right) => left - right));
  expect(tones).toHaveLength(5);
  expect(JSON.stringify(voicing)).toBe(before);
  for (const degree of [1, 3, 7, 13, 99]) expect(() => voiceChord(root, 'dominant13', { ...voicing, omitDegrees: [degree] })).toThrow();
  expect(() => voiceChord(root, 'dominant7Flat5', { ...voicing, omitDegrees: [5] })).toThrow(/altered/);
  expect(() => voiceChord(parsePitchName('C9')!, 'dominant13', voicing)).toThrow();
});

it('rejects aliases and inaudible distinctions, invalid fields and MIDI overflow', () => {
  expect(() => validatePracticeSpec({ ...choice, task: { kind: 'chord-identification', codes: ['aug', 'maj#5'] } })).toThrow(/ambiguous/);
  expect(() => validatePracticeSpec({ ...choice, stimulus: { ...choice.stimulus, rootMidi: [110, 120] } })).toThrow();
  expect(() => resolveHarmonyStep(root, 'major', { degree: 8, code: 'dom13' })).toThrow();
  expect(() => resolveHarmonyStep(root, 'major', { degree: 5, code: 'invented' })).toThrow();
  expect(resolveHarmonyStep(root, 'major', { degree: 5, code: '7#9' }).symbol).toBe('V:7#9');
  expect(resolveHarmonyStep(parsePitchName('Bb3')!, 'harmonicMinor', { degree: 5, code: '7b9' }).tones.map((tone) => tone.name)).toEqual(['F4', 'A4', 'C5', 'Eb5', 'Gb5']);
  const inversion = pack.lessons[1]!.spec as ChoicePracticeSpec;
  expect(() => validatePracticeSpec({ ...inversion, task: { kind: 'chord-inversion', qualities: ['dominant7Flat5'], inversions: [0, 2] } })).toThrow(/ambiguous/);
  expect(() => parseContentPack({ ...pack, lessons: [{ ...pack.lessons[0], spec: { ...choice,
    task: { kind: 'chord-identification', codes: ['dom13', 'maj13'], voicing: { bassDegree: 1, omitDegrees: [], spread: 'stacked', typo: true } } } }] })).toThrow();
});

it('audits all sample lessons and commits/replays correct answers through the real store', async () => {
  for (const entry of pack.lessons) expect(auditContentLesson(entry, makeRngFactory(), 8).samples).toBeGreaterThanOrEqual(8);
  const cases = contentPilotCases(pack, 42);
  for (const entry of cases) {
    const attempts: Attempt[] = [];
    const store = await createPilotStore({ loadAll: async () => [], append: async (attempt) => { attempts.push(attempt); }, exportJson: async () => '[]' },
      { now: () => 0, dayStart: () => 0 }, makeRngFactory(), 'piano');
    const item = store.startCase(entry);
    const key = item.key;
    if (key.type !== 'choice' && key.type !== 'functions') throw new Error('unexpected key');
    const response = key.type === 'choice' ? { kind: 'choice' as const, index: key.index, rtMs: 100 }
      : { kind: 'functions' as const, symbols: key.symbols, rtMs: 100 };
    expect((await store.commit(response)).correct).toBe(true);
    expect(attempts[0]!.templateKey).toBe(item.presented.templateKey);
    expect(store.startCase(entry)).toEqual(item);
  }
});
