import { createPilotStore, PILOT_CASES, pilotReference, scoreView } from '../src/store/pilot';
import { estimatePitch, segmentPitchFrames, pitchFromFrame } from '../src/engine/performance';
import type { Attempt, Clock, PitchFrame, Response, Storage } from '../src/engine/ports';
import type { NextItem } from '../src/engine/selection';
import { makeRngFactory } from './support/rng';

const clock: Clock = { now: () => 1_800_000_000_000, dayStart: (time) => Math.floor(time / 86400000) * 86400000 };
function memory(): Storage & { values: Attempt[] } {
  const values: Attempt[] = [];
  return { values, loadAll: async () => [...values], append: async (attempt) => { values.push(attempt); }, exportJson: async () => JSON.stringify(values) };
}
function answer(item: NextItem): Response {
  const key = item.key;
  if (key.type === 'choice') return { kind: 'choice', index: key.index, rtMs: 100 };
  if (key.type === 'functions') return { kind: 'functions', symbols: key.symbols, rtMs: 100 };
  if (key.type === 'locations') return { kind: 'locations', indices: key.indices, rtMs: 100 };
  if (key.type !== 'performance') throw new Error('unsupported pilot');
  if (key.mode === 'notation') return { kind: 'notation', score: item.answerScore!, rtMs: 100 };
  if (key.mode === 'sung') return { kind: 'sung', notes: [...key.notes], rtMs: 100 };
  return { kind: 'tapped', onsets: key.notes.map((note) => note.start), rtMs: 100 };
}

describe('manual pilot sessions', () => {
  it('covers 14 distinct types', () => { expect(PILOT_CASES).toHaveLength(14); expect(new Set(PILOT_CASES.map((entry) => entry.id)).size).toBe(14); });
  it.each(PILOT_CASES)('$id produces two repeatable, answerable questions and isolated attempts', async (example) => {
    const storage = memory();
    const store = await createPilotStore(storage, clock, makeRngFactory(), 'piano');
    const first = store.start(example.id);
    const reference = pilotReference(first);
    if (example.id.startsWith('rhythm-')) expect(reference).toBeNull();
    else if (example.id === 'interval-singing') {
      const sound = first.presented.stimulus!.find((event) => event.kind === 'note')!;
      expect(sound.kind === 'note' && reference?.midi).toBe(sound.kind === 'note' ? sound.midi : null);
      expect(reference?.midi).not.toBe(first.answerPitches[0]!.midi);
    } else if (example.id === 'chord' || example.id === 'inversion') {
      expect(reference?.midi).toBe(Math.min(...first.answerPitches.map((pitch) => pitch.midi)));
    } else expect(reference).toEqual(first.answerPitches[0]);
    expect(() => store.next()).toThrow();
    expect((await store.commit(answer(first))).correct).toBe(true);
    await expect(store.commit(answer(first))).rejects.toThrow();
    const second = store.next()!;
    expect(second).not.toBeNull();
    expect((await store.commit(answer(second))).correct).toBe(true);
    expect(store.next()).toBeNull();
    expect(store.result()).toEqual({ completed: 2, correct: 2, averageScore: 1 });
    expect(store.start(example.id)).toEqual(first);
    await store.commit(answer(first));
    expect(store.next()).toEqual(second);
    await store.commit(answer(second));
    expect(new Set(storage.values.map((attempt) => attempt.id)).size).toBe(4);
    for (const attempt of storage.values) {
      expect(attempt.reviewKeys).toContain(attempt.skill);
      expect(attempt.templateKey).toBeTruthy();
      expect(attempt.predictedP).toBeGreaterThan(0);
    }
    expect(store.answerName(first)).toBeTruthy();
    if (first.answerScore) expect(scoreView(first.answerScore).measures).toHaveLength(first.answerScore.measures.length);
  });
  it('failed persistence leaves the question available for retry', async () => {
    const storage = memory();
    const write = storage.append;
    storage.append = async () => { throw new Error('disk full'); };
    const store = await createPilotStore(storage, clock, makeRngFactory(), 'piano');
    const item = store.start('chord');
    await expect(store.commit(answer(item))).rejects.toThrow('disk full');
    expect(store.result().completed).toBe(0);
    expect(store.history()).toHaveLength(0);
    storage.append = write;
    await store.commit(answer(item));
    expect(store.result().completed).toBe(1);
  });
  it('blocks overlapping submissions and navigation during a pending write', async () => {
    const storage = memory();
    let release = (): void => {};
    storage.append = () => new Promise<void>((resolve) => { release = resolve; });
    const store = await createPilotStore(storage, clock, makeRngFactory(), 'piano');
    const item = store.start('chord');
    const pending = store.commit(answer(item));
    await expect(store.commit(answer(item))).rejects.toThrow();
    expect(() => store.start('interval')).toThrow();
    release(); await pending;
    expect(store.result().completed).toBe(1);
  });
});

describe('microphone pitch analysis', () => {
  it.each([110, 261.6256, 440, 659.2551])('detects %s Hz with harmonics at 44.1 and 48 kHz', (frequency) => {
    for (const rate of [44100, 48000]) {
      const samples = Float32Array.from({ length: 2048 }, (_, index) => 0.15 * Math.sin(2 * Math.PI * frequency * index / rate) + 0.07 * Math.sin(4 * Math.PI * frequency * index / rate));
      const result = estimatePitch(samples, rate, 100);
      expect(Math.abs(1200 * Math.log2(result.f0 / frequency))).toBeLessThan(3);
      expect(result.clarity).toBeGreaterThan(0.85);
    }
  });
  it('rejects silence, sub-threshold sound and invalid samples', () => {
    expect(estimatePitch(new Float32Array(2048), 48000, 0).f0).toBe(0);
    expect(estimatePitch(Float32Array.from({ length: 2048 }, (_, index) => 0.001 * Math.sin(index)), 48000, 0).f0).toBe(0);
    expect(() => estimatePitch(new Float32Array(2048).fill(NaN), 48000, 0)).toThrow();
    expect(() => estimatePitch(new Float32Array(10), 48000, 0)).toThrow();
  });
  const frame = (t: number, midi = 69, cents = 0): PitchFrame => ({ t, f0: 440 * 2 ** ((midi - 69 + cents / 100) / 12), clarity: 0.99, rms: 0.1 });
  it('segments pitch changes, silence and long gaps while preserving cents', () => {
    const frames = [0, 20, 40, 60, 80].map((time) => frame(time, 69, 20));
    frames.push({ ...frame(100), f0: 0 });
    frames.push(...[120, 140, 160, 180, 200].map((time) => frame(time, 71)));
    frames.push(...[400, 420, 440, 460, 480].map((time) => frame(time, 71)));
    const notes = segmentPitchFrames(frames);
    expect(notes.map((note) => note.midi)).toEqual([69, 71, 71]);
    expect(notes[0]!.cents).toBeCloseTo(20);
    expect(notes[0]!.dur).toBe(100);
    expect(notes[2]!.start).toBe(400);
  });
  it('enforces duration boundary and rejects unordered frames', () => {
    expect(segmentPitchFrames([frame(0), frame(20), frame(40), frame(60)], 80)).toHaveLength(1);
    expect(segmentPitchFrames([frame(0), frame(20), frame(40), frame(60)], 81)).toHaveLength(0);
    expect(() => segmentPitchFrames([frame(20), frame(0)])).toThrow();
    expect(() => segmentPitchFrames([], 0)).toThrow();
  });
  it('bridges a short breath dropout without extending trailing silence', () => {
    const frames = Array.from({ length: 20 }, (_, index) => frame(index * 20, 69, 18));
    frames[5] = { ...frames[5]!, rms: 0.001 };
    frames[6] = { ...frames[6]!, clarity: 0.3 };
    frames.push(...[400, 420, 440, 460, 480].map((time) => ({ ...frame(time), f0: 0 })));
    const notes = segmentPitchFrames(frames);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.start).toBe(0);
    expect(notes[0]!.dur).toBe(400);
    expect(notes[0]!.cents).toBeCloseTo(18);
  });
  it('separates sustained silence and preserves the 60ms dropout boundary', () => {
    for (const gap of [60, 80]) {
      const frames = [0, 20, 40, 60, 80].map((time) => frame(time));
      for (let time = 100; time < 100 + gap; time += 20) frames.push({ ...frame(time), f0: 0 });
      frames.push(...[0, 20, 40, 60, 80].map((time) => frame(100 + gap + time)));
      expect(segmentPitchFrames(frames)).toHaveLength(gap === 60 ? 1 : 2);
    }
  });
  it('ignores brief octave spikes but keeps sustained octave mistakes', () => {
    const frames = Array.from({ length: 30 }, (_, index) => frame(index * 20));
    frames[5] = frame(100, 81); frames[6] = frame(120, 81);
    expect(segmentPitchFrames(frames)).toHaveLength(1);
    expect(segmentPitchFrames(frames)[0]!.midi).toBe(69);
    for (let index = 15; index < 30; index += 1) frames[index] = frame(index * 20, 81);
    const notes = segmentPitchFrames(frames);
    expect(notes.map((note) => note.midi)).toEqual([69, 81]);
    expect(notes[1]!.start).toBe(300);
  });
  it('does not split semitone-boundary jitter or snap sharp singing to a target', () => {
    const frames = Array.from({ length: 30 }, (_, index) => frame(index * 20, 69, index % 2 ? 55 : 45));
    const notes = segmentPitchFrames(frames);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.midi + notes[0]!.cents / 100).toBeCloseTo(69.55);
  });
  it('retains short genuine semitone notes and their original onset', () => {
    const frames = [0, 20, 40, 60, 80].map((time) => frame(time));
    frames.push(...[100, 120, 140, 160, 180].map((time) => frame(time, 70)));
    frames.push(...[200, 220, 240, 260, 280].map((time) => frame(time, 69)));
    expect(segmentPitchFrames(frames).map((note) => [note.midi, note.start, note.dur])).toEqual([[69, 0, 100], [70, 100, 100], [69, 200, 100]]);
  });
  it('only exposes reliable fractional pitch frames, including threshold boundaries', () => {
    expect(pitchFromFrame(frame(0, 69, 25))).toBeCloseTo(69.25);
    expect(pitchFromFrame({ ...frame(0), clarity: 0.85, rms: 0.008 })).toBe(69);
    expect(pitchFromFrame({ ...frame(0), clarity: 0.849 })).toBeNull();
    expect(pitchFromFrame({ ...frame(0), rms: 0.0079 })).toBeNull();
    expect(pitchFromFrame({ ...frame(0), clarity: NaN })).toBeNull();
  });
});
