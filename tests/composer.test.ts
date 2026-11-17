import { describe, expect, it } from 'vitest';
import type { Attempt, Clock, Score, Storage } from '../src/engine/ports';
import { createPilotStore, customPilotCase } from '../src/store/pilot';
import { makeRngFactory } from './support/rng';

const clock: Clock = { now: () => 1800000000000, dayStart: (time) => Math.floor(time / 86400000) * 86400000 };
function melody(measures = 1): Score {
  return { clef: 'treble', measures: Array.from({ length: measures }, () => ({
    key: { tonic: 0, mode: 'major', fifths: 0 }, time: { beats: 4, unit: 4 },
    voices: [{ notes: Array.from({ length: 16 }, () => ({ pitch: { midi: 60, name: 'C4' }, duration: { value: 16, dots: 0 }, tie: false })) }],
  })) };
}
function memory(): Storage {
  const values: Attempt[] = [];
  return { loadAll: async () => values, append: async (attempt) => { values.push(attempt); }, exportJson: async () => JSON.stringify(values) };
}

describe('custom melody practice', () => {
  it('accepts 128 notes over eight bars, clones the draft and preserves deterministic generation', async () => {
    const draft = melody(8);
    const example = customPilotCase(draft, 40);
    draft.measures[0]!.voices[0]!.notes = [];
    const first = await createPilotStore(memory(), clock, makeRngFactory(), 'piano');
    const second = await createPilotStore(memory(), clock, makeRngFactory(), 'piano');
    const item = first.startCase(example);
    expect(item).toEqual(second.startCase(example));
    if (item.key.type !== 'performance') throw new Error('missing performance');
    expect(item.key.notes).toHaveLength(128);
    expect(item.key.end).toBe(48000);
    expect((await first.commit({ kind: 'sung', notes: [...item.key.notes], rtMs: 0 })).correct).toBe(true);
    expect(first.next()).toBeNull();
    expect(first.result()).toEqual({ completed: 1, correct: 1, averageScore: 1 });
  });
  it('rejects excessive bars, incomplete measures, empty performances and unsupported tempo', () => {
    expect(() => customPilotCase(melody(9), 90)).toThrow();
    const incomplete = melody(); incomplete.measures[0]!.voices[0]!.notes.pop();
    expect(() => customPilotCase(incomplete, 90)).toThrow();
    const silent = melody(); silent.measures[0]!.voices[0]!.notes.forEach((note) => { note.pitch = null; });
    expect(() => customPilotCase(silent, 90)).toThrow();
    for (const tempo of [39.99, 200.01, NaN]) expect(() => customPilotCase(melody(), tempo)).toThrow();
    expect(() => customPilotCase(melody(), 200)).not.toThrow();
  });
});
