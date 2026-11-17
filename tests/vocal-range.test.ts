import { describe, expect, it, vi, afterEach } from 'vitest';
import { PILOT_CASES, VOCAL_RANGES, vocalLesson, vocalOctaves } from '../src/engine/config';
import { createPilotStore } from '../src/store/pilot';
import { LocalSettings } from '../src/adapters/settings';
import type { Attempt, Clock, Storage } from '../src/engine/ports';
import { makeRngFactory } from './support/rng';
import { generateExercise } from '../src/engine/items';

const clock: Clock = { now: () => 1800000000000, dayStart: (time) => Math.floor(time / 86400000) * 86400000 };
const melody = PILOT_CASES.find((entry) => entry.id === 'melody-singing')!.lesson;
function memory(): Storage & { values: Attempt[] } {
  const values: Attempt[] = [];
  return { values, loadAll: async () => values, append: async (attempt) => { values.push(attempt); }, exportJson: async () => JSON.stringify(values) };
}

describe('vocal register', () => {
  it('fits whole octaves deterministically, including range boundaries', () => {
    expect(vocalOctaves([60, 67], 'tenor', { low: 60, high: 72 })).toBe(0);
    expect(vocalOctaves([60, 67], 'tenor', { low: 48, high: 60 })).toBe(-1);
    expect(() => vocalOctaves([60], 'tenor', { low: 60, high: 48 })).toThrow('comfortable');
    expect(vocalOctaves([60, 67], 'tenor')).toBe(-1);
    expect(vocalOctaves([48, 67], 'tenor')).toBe(0);
    expect(vocalOctaves([60, 67], 'original')).toBe(0);
    expect(vocalOctaves([], 'bass')).toBe(0);
    for (const voice of VOCAL_RANGES) {
      const shift = vocalOctaves([0, 127], voice.id);
      expect(shift).toBe(0);
    }
  });
  it('preserves spelling, rests, durations and the source score while selecting a clef', () => {
    const before = JSON.stringify(melody);
    const fitted = vocalLesson(melody, 'tenor');
    const source = melody.exerciseSpec!;
    const spec = fitted.exerciseSpec!;
    if (!('scores' in source) || !('scores' in spec)) throw new Error('missing scores');
    expect(spec.scores[0]!.clef).toBe('bass');
    const first = spec.scores[0]!.measures[0]!.voices[0]!.notes[0]!;
    expect(first.pitch).toEqual({ midi: 48, name: 'C3' });
    expect(first.duration).toEqual(source.scores[0]!.measures[0]!.voices[0]!.notes[0]!.duration);
    expect(JSON.stringify(melody)).toBe(before);
    expect(vocalLesson(melody, 'original')).toBe(melody);
    const rhythm = PILOT_CASES.find((entry) => entry.id === 'rhythm-reading')!.lesson;
    expect(vocalLesson(rhythm, 'tenor')).toBe(rhythm);
  });
  it('transposes generated melody constraints into the selected vocal register', () => {
    const base = melody.exerciseSpec;
    if (!base || base.kind !== 'melody-singing') throw new Error('missing melody exercise');
    const generated = { ...base, scores: [], generator: {
      kind: 'diatonic-melody' as const, version: 1 as const, clef: 'treble' as const,
      key: { tonic: 0, mode: 'major' as const, fifths: 0 }, time: { beats: 4, unit: 4 as const },
      measures: 2, durations: [{ value: 4 as const, dots: 0 as const }], restProbability: 0,
      pitchRange: [60, 72] as const, maxLeapSemitones: 5,
    } };
    const fitted = vocalLesson({ ...melody, exerciseSpec: generated }, 'tenor');
    const fittedSpec = fitted.exerciseSpec;
    if (!fittedSpec || fittedSpec.kind !== 'melody-singing' || fittedSpec.generator?.kind !== 'diatonic-melody') throw new Error('missing generated melody rule');
    expect(fittedSpec.generator.pitchRange).toEqual([48, 60]);
    expect(fittedSpec.generator.clef).toBe('bass');
    const item = generateExercise(fittedSpec, 13, makeRngFactory());
    expect(item.answerScore?.measures.flatMap((measure) => measure.voices[0]!.notes.flatMap((note) => note.pitch ? [note.pitch.midi] : []))
      .every((midi) => midi >= 48 && midi <= 60)).toBe(true);
  });
  it.each(['interval-singing', 'melody-singing', 'melody-imitation'])('keeps %s stimulus, answer, scoring and replay identity in the same register', async (id) => {
    const storage = memory();
    const store = await createPilotStore(storage, clock, makeRngFactory(), 'piano', 'tenor');
    const other = await createPilotStore(memory(), clock, makeRngFactory(), 'piano', 'tenor');
    const original = await createPilotStore(memory(), clock, makeRngFactory(), 'piano');
    const item = store.start(id);
    const unchanged = original.start(id);
    const shift = id === 'interval-singing' ? 0 : -12;
    expect(item).toEqual(other.start(id));
    expect(item.presented.templateKey).not.toBe(unchanged.presented.templateKey);
    expect(item.presented.stimulus?.filter((event) => event.kind === 'note').map((event) => event.midi))
      .toEqual(unchanged.presented.stimulus?.filter((event) => event.kind === 'note').map((event) => event.midi + shift));
    if (item.key.type !== 'performance' || unchanged.key.type !== 'performance') throw new Error('missing performance');
    expect(item.key.notes.map((note) => note.midi)).toEqual(unchanged.key.notes.map((note) => note.midi + shift));
    expect((await store.commit({ kind: 'sung', notes: [...item.key.notes], rtMs: 100 })).correct).toBe(true);
    expect(storage.values[0]!.templateKey).toBe(item.presented.templateKey);
    expect(store.next()).not.toBeNull();
  });
});

describe('saved vocal preference', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('loads old settings and saves the global voice without losing timbre', () => {
    let value = JSON.stringify({ timbre: 'organ' });
    vi.stubGlobal('localStorage', { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } });
    const settings = new LocalSettings();
    expect(settings.load()).toEqual({ timbre: 'organ', vocalRange: 'original' });
    settings.save({ timbre: 'organ', vocalRange: 'tenor', vocalBounds: { low: 48, high: 60 } });
    expect(new LocalSettings().load()).toEqual({ timbre: 'organ', vocalRange: 'tenor', vocalBounds: { low: 48, high: 60 } });
    value = JSON.stringify({ vocalRange: 'tenor', vocalBounds: { low: 72, high: 48 } });
    expect(settings.load().vocalBounds).toBeUndefined();
    value = JSON.stringify({ vocalRange: 'unknown' });
    expect(settings.load().vocalRange).toBe('original');
  });
});
