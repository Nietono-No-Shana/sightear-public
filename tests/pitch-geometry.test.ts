import { describe, expect, it } from 'vitest';
import { durationBeats, keySignatureMarks, pitchPosition, staffPosition, timelineX } from '../src/ui/pitch-geometry';

describe('staff pitch coordinates', () => {
  it('maps natural notes to staff steps, with unequal semitone spacing', () => {
    expect(pitchPosition(64)).toBe(30);
    expect(pitchPosition(65)).toBe(31);
    expect(pitchPosition(67)).toBe(32);
    expect(pitchPosition(64.5)).toBe(30.5);
    expect(pitchPosition(66)).toBe(31.5);
    expect(pitchPosition(43)).toBe(18);
  });
  it.each([['C#4', 61, 28], ['Db4', 61, 29], ['B#3', 60, 27], ['Cb4', 59, 28], ['F##4', 67, 31]] as const)('aligns %s with its written note', (name, midi, position) => {
    expect(staffPosition(name)).toBe(position);
    expect(pitchPosition(midi, { midi, position })).toBe(position);
    expect(pitchPosition(midi - 0.1, { midi, position })).toBeLessThan(position);
    expect(pitchPosition(midi + 0.1, { midi, position })).toBeGreaterThan(position);
  });
});

describe('staff key signatures', () => {
  it('places treble-clef sharps and flats on their conventional octaves', () => {
    expect(keySignatureMarks(1, 'treble')).toEqual([{ letter: 'F', octave: 5, step: 8 }]);
    expect(keySignatureMarks(-1, 'treble')).toEqual([{ letter: 'B', octave: 4, step: 4 }]);
    expect(keySignatureMarks(3, 'treble').map((mark) => [mark.letter, mark.step])).toEqual([['F', 8], ['C', 5], ['G', 9]]);
    expect(keySignatureMarks(-7, 'treble').map((mark) => mark.step)).toEqual([4, 7, 3, 6, 2, 5, 1]);
  });
  it('places bass-clef sharps and flats inside the staff', () => {
    expect(keySignatureMarks(1, 'bass')).toEqual([{ letter: 'F', octave: 3, step: 6 }]);
    expect(keySignatureMarks(-1, 'bass')).toEqual([{ letter: 'B', octave: 2, step: 2 }]);
    expect(keySignatureMarks(3, 'bass').map((mark) => [mark.letter, mark.step])).toEqual([['F', 6], ['C', 3], ['G', 7]]);
    expect(keySignatureMarks(-7, 'bass').map((mark) => mark.step)).toEqual([2, 5, 1, 4, 0, 3, 6]);
  });
  it('returns no marks for C major or invalid signatures', () => {
    expect(keySignatureMarks(0, 'treble')).toEqual([]);
    expect(keySignatureMarks(8, 'treble')).toEqual([]);
    expect(keySignatureMarks(-8, 'bass')).toEqual([]);
  });
});

describe('staff time coordinates', () => {
  it('includes dotted, double dotted and tuplet durations', () => {
    expect(durationBeats({ value: 4, dots: 1 })).toBe(1.5);
    expect(durationBeats({ value: 2, dots: 2 })).toBe(3.5);
    expect(durationBeats({ value: 8, dots: 0, tuplet: { actual: 3, normal: 2 } })).toBeCloseTo(1 / 3);
  });
  it('interpolates within unequal durations and clamps outside the score', () => {
    const points = [{ time: 0, x: 140 }, { time: 750, x: 380 }, { time: 1000, x: 460 }];
    expect(timelineX(-1, points)).toBe(140);
    expect(timelineX(375, points)).toBe(260);
    expect(timelineX(750, points)).toBe(380);
    expect(timelineX(875, points)).toBe(420);
    expect(timelineX(1450, points)).toBe(460);
  });
});
