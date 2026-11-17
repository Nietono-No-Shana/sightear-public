import { describe, expect, it } from 'vitest';
import { segmentPitchFrames } from '@engine/performance';
import type { PitchFrame } from '@engine/ports';

const voiced = (t: number, midi = 60): PitchFrame => ({ t, f0: 440 * 2 ** ((midi - 69) / 12), clarity: 0.99, rms: 0.1 });
const attack = (t: number, rms = 0.04): PitchFrame => ({ t, f0: 0, clarity: 0, rms });
const tone = (start: number): PitchFrame[] => Array.from({ length: 6 }, (_, index) => voiced(start + index * 20));

describe('singing attack timing', () => {
  it('recovers a short energetic attack without adding the pitch-confirmation delay to onset', () => {
    const notes = segmentPitchFrames([attack(0, 0), attack(20), attack(40), ...tone(60)]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ midi: 60, start: 20, dur: 160 });
    expect(notes[0]!.cents).toBeCloseTo(0);
  });
  it('accepts a 60ms attack but rejects an uninterrupted longer noise run', () => {
    expect(segmentPitchFrames([attack(0), attack(20), attack(40), ...tone(60)])[0]!.start).toBe(0);
    expect(segmentPitchFrames([attack(0), attack(20), attack(40), attack(60), ...tone(61)])[0]!.start).toBe(61);
  });
  it('does not manufacture an early onset from silence or a weak breath', () => {
    for (const rms of [0, 0.001, 0.0249]) {
      expect(segmentPitchFrames([attack(0, rms), attack(20, rms), ...tone(40)])[0]!.start).toBe(40);
    }
    expect(segmentPitchFrames([attack(0, 0.025), ...tone(20)])[0]!.start).toBe(0);
  });
  it('preserves a genuinely late start and does not align it to a target beat', () => {
    const silence = Array.from({ length: 10 }, (_, index) => attack(index * 20, 0));
    expect(segmentPitchFrames([...silence, attack(200), attack(220), ...tone(240)])[0]!.start).toBe(200);
  });
  it('does not bridge missing samples or use attack energy to turn a pitch blip into a note', () => {
    expect(segmentPitchFrames([attack(0), ...tone(41)])[0]!.start).toBe(41);
    expect(segmentPitchFrames([attack(0), attack(20), attack(40), voiced(60), voiced(80)])).toEqual([]);
    expect(segmentPitchFrames([attack(0), attack(20), attack(40)])).toEqual([]);
  });
  it('keeps confirmed pitch changes at their first candidate frame', () => {
    const frames = [...tone(0), ...Array.from({ length: 6 }, (_, index) => voiced(120 + index * 20, 62))];
    expect(segmentPitchFrames(frames).map((note) => [note.start, note.dur])).toEqual([[0, 120], [120, 120]]);
  });
  it('absorbs onset and mid-note pitch glitches instead of manufacturing extra notes', () => {
    const run = (start: number, end: number, midi: number): PitchFrame[] =>
      Array.from({ length: Math.max(1, Math.round((end - start) / 20)) }, (_, index) => voiced(start + index * 20, midi));
    expect(segmentPitchFrames([...run(0, 100, 56), ...run(100, 1000, 57)])).toEqual([
      { midi: 57, cents: 0, start: 0, dur: 1000 },
    ]);
    expect(segmentPitchFrames([...run(0, 400, 57), ...run(400, 500, 56.1), ...run(500, 1000, 57)])).toEqual([
      { midi: 57, cents: 0, start: 0, dur: 1000 },
    ]);
    expect(segmentPitchFrames([...run(0, 120, 56), ...run(120, 900, 57)])).toEqual([
      { midi: 57, cents: 0, start: 0, dur: 900 },
    ]);
  });
});
