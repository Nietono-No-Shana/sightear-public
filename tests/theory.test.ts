import type { Duration, TimeSignature } from '@engine/ports';
import {
  A4_HZ,
  assertDuration,
  assertMidi,
  assertTimeSignature,
  buildChord,
  buildScale,
  centsBetween,
  centsFromEqualTemperament,
  chordIntervals,
  chordLabel,
  chordToPitches,
  diatonicChord,
  durationInWholeNotes,
  durationTicks,
  frequencyToMidi,
  intervalBetween,
  invertInterval,
  isClosedVoicing,
  isInScale,
  isMeasureComplete,
  isMidi,
  letterAt,
  makeInterval,
  makeSpelled,
  measureLengthInWholeNotes,
  midiToFrequency,
  midiToName,
  midiToOctave,
  midiToPitch,
  midiToPitchClass,
  parsePitchName,
  pitchClassName,
  qualityOf,
  scaleDegree,
  scalePitchClasses,
  scaleToPitches,
  toPitch,
  transposeBy,
  type ChordQuality,
  type IntervalQuality,
  type SpelledPitch,
} from '@engine/theory';

function spelled(name: string): SpelledPitch {
  const pitch = parsePitchName(name);
  if (pitch === null) {
    throw new Error(`test fixture is not a valid pitch name: ${name}`);
  }
  return pitch;
}

describe('pitch', () => {
  it('validates MIDI bounds', () => {
    expect(isMidi(0)).toBe(true);
    expect(isMidi(60)).toBe(true);
    expect(isMidi(127)).toBe(true);
    expect(isMidi(-1)).toBe(false);
    expect(isMidi(128)).toBe(false);
    expect(isMidi(60.5)).toBe(false);
    expect(isMidi(Number.NaN)).toBe(false);

    expect(() => assertMidi(60)).not.toThrow();
    expect(() => assertMidi(128)).toThrow(RangeError);
  });

  it('converts MIDI to frequency and back', () => {
    expect(midiToFrequency(69)).toBe(A4_HZ);
    expect(midiToFrequency(57)).toBeCloseTo(220, 10);
    expect(midiToFrequency(60)).toBeCloseTo(261.625565, 5);

    for (let midi = 0; midi <= 127; midi += 1) {
      expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 8);
    }

    expect(frequencyToMidi(440)).toBe(69);
    expect(() => frequencyToMidi(0)).toThrow(RangeError);
    expect(() => frequencyToMidi(-1)).toThrow(RangeError);
    expect(() => frequencyToMidi(Number.NaN)).toThrow(RangeError);
  });

  it('measures cents relative to a reference', () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 8);
    expect(centsBetween(440, 880)).toBeCloseTo(-1200, 8);
    expect(centsBetween(440, 440)).toBe(0);
    expect(centsFromEqualTemperament(midiToFrequency(69), 69)).toBeCloseTo(0, 8);
    expect(centsFromEqualTemperament(440, 68)).toBeCloseTo(100, 8);
    expect(() => centsBetween(0, 440)).toThrow(RangeError);
    expect(() => centsBetween(440, 0)).toThrow(RangeError);
  });

  it('derives pitch class and octave', () => {
    expect(midiToPitchClass(60)).toBe(0);
    expect(midiToPitchClass(61)).toBe(1);
    expect(midiToPitchClass(72)).toBe(0);
    expect(midiToPitchClass(127)).toBe(7);

    expect(midiToOctave(60)).toBe(4);
    expect(midiToOctave(69)).toBe(4);
    expect(midiToOctave(0)).toBe(-1);
    expect(midiToOctave(12)).toBe(0);
    expect(midiToOctave(127)).toBe(9);
  });

  it('names MIDI notes with sharps or flats', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(61)).toBe('C#4');
    expect(midiToName(61, true)).toBe('Db4');
    expect(midiToName(0)).toBe('C-1');
    expect(midiToName(127)).toBe('G9');
    expect(() => midiToName(128)).toThrow(RangeError);

    expect(pitchClassName(0)).toBe('C');
    expect(pitchClassName(1)).toBe('C#');
    expect(pitchClassName(1, true)).toBe('Db');
    expect(() => pitchClassName(12)).toThrow(RangeError);
    expect(() => pitchClassName(-1)).toThrow(RangeError);

    expect(midiToPitch(61)).toEqual({ midi: 61, name: 'C#4' });
    expect(midiToPitch(61, true)).toEqual({ midi: 61, name: 'Db4' });
  });

  it('indexes letters', () => {
    expect(letterAt(0)).toBe('C');
    expect(letterAt(6)).toBe('B');
    expect(() => letterAt(7)).toThrow(RangeError);
    expect(() => letterAt(-1)).toThrow(RangeError);
  });

  it('builds spelled pitches', () => {
    expect(makeSpelled('C', 0, 4)).toEqual({
      letter: 'C',
      accidental: 0,
      octave: 4,
      midi: 60,
      name: 'C4',
    });
    expect(makeSpelled('B', 0, 3).midi).toBe(59);
    expect(makeSpelled('B', -1, 3).name).toBe('Bb3');
    expect(makeSpelled('F', 2, 4).midi).toBe(67);
    expect(makeSpelled('F', 2, 4).name).toBe('F##4');

    expect(() => makeSpelled('C', 3, 4)).toThrow(RangeError);
    expect(() => makeSpelled('C', 0, 10)).toThrow(RangeError);
    expect(() => makeSpelled('C', 0, 4.5)).toThrow(RangeError);
  });

  it('parses pitch names', () => {
    expect(spelled('F#4').midi).toBe(66);
    expect(spelled('Bb3').midi).toBe(58);
    expect(spelled('C-1').midi).toBe(0);
    expect(spelled('c♭4').name).toBe('Cb4');
    expect(spelled('C♯4').name).toBe('C#4');

    expect(parsePitchName('H4')).toBeNull();
    expect(parsePitchName('')).toBeNull();
    expect(parsePitchName('C#')).toBeNull();
    expect(parsePitchName('C###4')).toBeNull();
    expect(parsePitchName('Cb-1')).toBeNull();
  });

  it('converts spelled pitch to the port Pitch shape', () => {
    expect(toPitch(spelled('F#4'))).toEqual({ midi: 66, name: 'F#4' });
  });
});

describe('interval', () => {
  it('derives interval quality from number and semitones', () => {
    const cases: ReadonlyArray<readonly [number, number, IntervalQuality]> = [
      [1, 0, 'P'],
      [1, 1, 'A'],
      [2, 2, 'M'],
      [2, 1, 'm'],
      [2, 0, 'd'],
      [3, 4, 'M'],
      [3, 3, 'm'],
      [4, 5, 'P'],
      [4, 6, 'A'],
      [5, 7, 'P'],
      [5, 6, 'd'],
      [6, 9, 'M'],
      [6, 8, 'm'],
      [7, 11, 'M'],
      [7, 10, 'm'],
      [8, 12, 'P'],
      [8, 11, 'd'],
      [9, 14, 'M'],
      [9, 13, 'm'],
      [16, 26, 'M'],
      [22, 36, 'P'],
    ];
    for (const [number, semitones, quality] of cases) {
      expect(qualityOf(number, semitones)).toBe(quality);
    }

    expect(qualityOf(0, 0)).toBeNull();
    expect(qualityOf(2, -1)).toBeNull();
    expect(qualityOf(2, 1.5)).toBeNull();
    expect(qualityOf(1, 2)).toBeNull();
    expect(qualityOf(4, 3)).toBeNull();
  });

  it('builds labelled intervals', () => {
    expect(makeInterval(5, 7)).toEqual({ number: 5, semitones: 7, quality: 'P', label: 'P5' });
    expect(makeInterval(3, 3).label).toBe('m3');
    expect(makeInterval(4, 6).label).toBe('A4');
    expect(makeInterval(8, 12).label).toBe('P8');
    expect(makeInterval(22, 36).label).toBe('P22');
    expect(() => makeInterval(1, 2)).toThrow(RangeError);
    expect(() => makeInterval(0, 0)).toThrow(RangeError);
  });

  it('measures intervals between spelled pitches', () => {
    expect(intervalBetween(spelled('C4'), spelled('G4'))).toMatchObject({
      number: 5,
      semitones: 7,
      quality: 'P',
      label: 'P5',
    });
    expect(intervalBetween(spelled('C4'), spelled('Eb4')).label).toBe('m3');
    expect(intervalBetween(spelled('C4'), spelled('F#4')).label).toBe('A4');
    expect(intervalBetween(spelled('C4'), spelled('Gb4')).label).toBe('d5');
    expect(intervalBetween(spelled('C4'), spelled('C5')).label).toBe('P8');
    expect(intervalBetween(spelled('C4'), spelled('D5')).label).toBe('M9');
    expect(intervalBetween(spelled('C4'), spelled('C7')).label).toBe('P22');
    expect(intervalBetween(spelled('B3'), spelled('C4')).label).toBe('m2');
    expect(intervalBetween(spelled('G3'), spelled('C4')).label).toBe('P4');

    expect(() => intervalBetween(spelled('G4'), spelled('C4'))).toThrow(RangeError);
  });

  it('transposes by spelled interval number and semitones', () => {
    expect(transposeBy(spelled('C4'), 5, 7).name).toBe('G4');
    expect(transposeBy(spelled('C4'), 3, 3).name).toBe('Eb4');
    expect(transposeBy(spelled('C4'), 7, 10).name).toBe('Bb4');
    expect(transposeBy(spelled('F#4'), 3, 4).name).toBe('A#4');
    expect(transposeBy(spelled('G#4'), 5, 7).name).toBe('D#5');
    expect(transposeBy(spelled('C4'), 22, 36).name).toBe('C7');

    const sixth = transposeBy(spelled('C4'), 6, 9);
    expect(intervalBetween(spelled('C4'), sixth).label).toBe('M6');

    expect(() => transposeBy(spelled('C4'), 0, 0)).toThrow(RangeError);
    expect(() => transposeBy(spelled('C4'), 3, -1)).toThrow(RangeError);
  });

  it('inverts simple intervals', () => {
    expect(invertInterval(makeInterval(5, 7))).toMatchObject({ number: 4, semitones: 5, label: 'P4' });
    expect(invertInterval(makeInterval(3, 4)).label).toBe('m6');
    expect(invertInterval(makeInterval(4, 6)).label).toBe('d5');
    expect(invertInterval(makeInterval(8, 12)).label).toBe('P1');
    expect(invertInterval(makeInterval(7, 10)).label).toBe('M2');
    expect(() => invertInterval(makeInterval(9, 14))).toThrow(RangeError);
  });
});

describe('chord', () => {
  const cases: ReadonlyArray<readonly [ChordQuality, readonly number[]]> = [
    ['major', [60, 64, 67]],
    ['minor', [60, 63, 67]],
    ['diminished', [60, 63, 66]],
    ['augmented', [60, 64, 68]],
    ['dominant7', [60, 64, 67, 70]],
    ['major7', [60, 64, 67, 71]],
    ['minor7', [60, 63, 67, 70]],
    ['halfDiminished7', [60, 63, 66, 70]],
    ['diminished7', [60, 63, 66, 69]],
    ['minor9', [60, 63, 67, 70, 74]],
    ['dominant9', [60, 64, 67, 70, 74]],
    ['dominant7b9', [60, 64, 67, 70, 73]],
    ['major79', [60, 64, 67, 71, 74]],
    ['suspended2', [60, 62, 67]],
    ['suspended4', [60, 65, 67]],
    ['dominant7sus4', [60, 65, 67, 70]],
    ['majorFlat5', [60, 64, 66]],
    ['majorSharp5', [60, 64, 68]],
    ['dominant7Flat5', [60, 64, 66, 70]],
    ['dominant7Sharp5', [60, 64, 68, 70]],
    ['major6', [60, 64, 67, 69]],
    ['minor6', [60, 63, 67, 69]],
    ['majorAdd9', [60, 64, 67, 74]],
    ['minorAdd9', [60, 63, 67, 74]],
    ['major6Flat5', [60, 64, 66, 69]],
    ['major6Sharp5', [60, 64, 68, 69]],
    ['major7Flat5', [60, 64, 66, 71]],
    ['major7Sharp5', [60, 64, 68, 71]],
    ['major7sus4', [60, 65, 67, 71]],
  ];

  it('builds every chord quality in root position', () => {
    for (const [quality, expected] of cases) {
      const tones = buildChord(spelled('C4'), quality);
      expect(tones.map((tone) => tone.midi)).toEqual(expected);
    }
  });

  it('spells chord tones correctly', () => {
    expect(buildChord(spelled('C4'), 'major').map((tone) => tone.name)).toEqual([
      'C4',
      'E4',
      'G4',
    ]);
    expect(buildChord(spelled('Cb4'), 'major').map((tone) => tone.name)).toEqual([
      'Cb4',
      'Eb4',
      'Gb4',
    ]);
    expect(buildChord(spelled('G#4'), 'major').map((tone) => tone.name)).toEqual([
      'G#4',
      'B#4',
      'D#5',
    ]);
    expect(buildChord(spelled('C4'), 'diminished7').map((tone) => tone.name)).toEqual([
      'C4',
      'Eb4',
      'Gb4',
      'Bbb4',
    ]);
  });

  it('builds inversions by moving the lowest tones up an octave', () => {
    expect(buildChord(spelled('C4'), 'major', 1).map((tone) => tone.midi)).toEqual([64, 67, 72]);
    expect(buildChord(spelled('C4'), 'major', 2).map((tone) => tone.midi)).toEqual([67, 72, 76]);
    expect(buildChord(spelled('C4'), 'major', 2).map((tone) => tone.name)).toEqual([
      'G4',
      'C5',
      'E5',
    ]);

    expect(() => buildChord(spelled('C4'), 'major', 3)).toThrow(RangeError);
    expect(() => buildChord(spelled('C4'), 'major', -1)).toThrow(RangeError);
  });

  it('reports intervals from the root', () => {
    expect(chordIntervals('major').map((interval) => interval.label)).toEqual(['M3', 'P5']);
    expect(chordIntervals('minor').map((interval) => interval.label)).toEqual(['m3', 'P5']);
    expect(chordIntervals('diminished').map((interval) => interval.label)).toEqual(['m3', 'd5']);
    expect(chordIntervals('augmented').map((interval) => interval.label)).toEqual(['M3', 'A5']);
    expect(chordIntervals('dominant7').map((interval) => interval.label)).toEqual([
      'M3',
      'P5',
      'm7',
    ]);
    expect(chordIntervals('major7').map((interval) => interval.label)).toEqual(['M3', 'P5', 'M7']);
    expect(chordIntervals('halfDiminished7').map((interval) => interval.label)).toEqual([
      'm3',
      'd5',
      'm7',
    ]);
  });

  it('labels chord qualities', () => {
    expect(chordLabel('major')).toBe('maj');
    expect(chordLabel('minor')).toBe('min');
    expect(chordLabel('diminished')).toBe('dim');
    expect(chordLabel('augmented')).toBe('aug');
    expect(chordLabel('dominant7')).toBe('dom7');
    expect(chordLabel('major7')).toBe('maj7');
    expect(chordLabel('minor7')).toBe('min7');
    expect(chordLabel('halfDiminished7')).toBe('m7b5');
    expect(chordLabel('diminished7')).toBe('dim7');
    expect(chordLabel('minor9')).toBe('min9');
    expect(chordLabel('dominant9')).toBe('dom9');
    expect(chordLabel('dominant7b9')).toBe('7b9');
    expect(chordLabel('major79')).toBe('maj79');
    expect(chordLabel('suspended2')).toBe('sus2');
    expect(chordLabel('suspended4')).toBe('sus4');
    expect(chordLabel('dominant7sus4')).toBe('7sus4');
    expect(chordLabel('majorFlat5')).toBe('majb5');
    expect(chordLabel('majorSharp5')).toBe('maj#5');
    expect(chordLabel('dominant7Flat5')).toBe('7b5');
    expect(chordLabel('dominant7Sharp5')).toBe('7#5');
    expect(chordLabel('major6')).toBe('maj6');
    expect(chordLabel('minor6')).toBe('min6');
    expect(chordLabel('majorAdd9')).toBe('majadd9');
    expect(chordLabel('minorAdd9')).toBe('minadd9');
    expect(chordLabel('major6Flat5')).toBe('maj6b5');
    expect(chordLabel('major6Sharp5')).toBe('maj6#5');
    expect(chordLabel('major7Flat5')).toBe('maj7b5');
    expect(chordLabel('major7Sharp5')).toBe('maj7#5');
    expect(chordLabel('major7sus4')).toBe('maj7sus4');
  });

  it('converts tones to port pitches', () => {
    expect(chordToPitches(buildChord(spelled('C4'), 'major'))).toEqual([
      { midi: 60, name: 'C4' },
      { midi: 64, name: 'E4' },
      { midi: 67, name: 'G4' },
    ]);
  });

  it('detects closed voicing', () => {
    expect(isClosedVoicing(buildChord(spelled('C4'), 'major'))).toBe(true);
    expect(isClosedVoicing([spelled('C4'), spelled('G4'), spelled('E5')])).toBe(false);
    expect(isClosedVoicing([spelled('C4')])).toBe(true);
    expect(() => isClosedVoicing([])).toThrow(RangeError);
  });
});

describe('scale', () => {
  it('builds major scales with correct spelling', () => {
    expect(buildScale(spelled('C4'), 'major').map((pitch) => pitch.name)).toEqual([
      'C4',
      'D4',
      'E4',
      'F4',
      'G4',
      'A4',
      'B4',
    ]);
    expect(buildScale(spelled('F#4'), 'major').map((pitch) => pitch.name)).toEqual([
      'F#4',
      'G#4',
      'A#4',
      'B4',
      'C#5',
      'D#5',
      'E#5',
    ]);
    expect(buildScale(spelled('Cb4'), 'major').map((pitch) => pitch.name)).toEqual([
      'Cb4',
      'Db4',
      'Eb4',
      'Fb4',
      'Gb4',
      'Ab4',
      'Bb4',
    ]);
  });

  it('builds natural and harmonic minor scales', () => {
    expect(buildScale(spelled('A4'), 'naturalMinor').map((pitch) => pitch.name)).toEqual([
      'A4',
      'B4',
      'C5',
      'D5',
      'E5',
      'F5',
      'G5',
    ]);
    expect(buildScale(spelled('A4'), 'harmonicMinor').map((pitch) => pitch.name)).toEqual([
      'A4',
      'B4',
      'C5',
      'D5',
      'E5',
      'F5',
      'G#5',
    ]);
  });

  it('converts scale tones to port pitches', () => {
    const pitches = scaleToPitches(buildScale(spelled('C4'), 'major'));
    expect(pitches).toHaveLength(7);
    expect(pitches[6]).toEqual({ midi: 71, name: 'B4' });
  });

  it('reads degrees, including compound degrees', () => {
    const cMajor = spelled('C4');
    expect(scaleDegree(cMajor, 'major', 1).name).toBe('C4');
    expect(scaleDegree(cMajor, 'major', 5).name).toBe('G4');
    expect(scaleDegree(cMajor, 'major', 8).name).toBe('C5');
    expect(scaleDegree(cMajor, 'major', 9).name).toBe('D5');
    expect(scaleDegree(cMajor, 'major', 15).name).toBe('C6');
    expect(() => scaleDegree(cMajor, 'major', 0)).toThrow(RangeError);
    expect(() => scaleDegree(cMajor, 'major', 1.5)).toThrow(RangeError);
  });

  it('checks scale membership by spelling and by pitch class', () => {
    const cMajor = spelled('C4');
    expect(isInScale(spelled('C4'), cMajor, 'major')).toBe(true);
    expect(isInScale(spelled('C5'), cMajor, 'major')).toBe(true);
    expect(isInScale(spelled('C#4'), cMajor, 'major')).toBe(false);
    expect(isInScale(spelled('B#4'), cMajor, 'major')).toBe(false);
    expect(isInScale(spelled('B4'), cMajor, 'major')).toBe(true);
    expect(scalePitchClasses(cMajor, 'major')).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('rejects keys that need more than double accidentals', () => {
    expect(() => buildScale(spelled('B##4'), 'major')).toThrow(/cannot spell/);
    expect(buildScale(spelled('B#4'), 'major').map((pitch) => pitch.name)).toEqual([
      'B#4',
      'C##5',
      'D##5',
      'E#5',
      'F##5',
      'G##5',
      'A##5',
    ]);
  });

  it('constructs diatonic triads and sevenths', () => {
    const cMajor = spelled('C4');
    const triadQualities = [1, 2, 3, 4, 5, 6, 7].map(
      (degree) => diatonicChord(cMajor, 'major', degree)?.quality,
    );
    expect(triadQualities).toEqual([
      'major',
      'minor',
      'minor',
      'major',
      'major',
      'minor',
      'diminished',
    ]);

    const seventhQualities = [1, 2, 3, 4, 5, 6, 7].map(
      (degree) => diatonicChord(cMajor, 'major', degree, 4)?.quality,
    );
    expect(seventhQualities).toEqual([
      'major7',
      'minor7',
      'minor7',
      'major7',
      'dominant7',
      'minor7',
      'halfDiminished7',
    ]);

    const v7 = diatonicChord(cMajor, 'major', 5, 4);
    expect(v7?.quality).toBe('dominant7');
    expect(v7?.tones.map((tone) => tone.name)).toEqual(['G4', 'B4', 'D5', 'F5']);

    const cHarmonicMinor = spelled('C4');
    expect(diatonicChord(cHarmonicMinor, 'harmonicMinor', 3)?.quality).toBe('augmented');
    expect(diatonicChord(cHarmonicMinor, 'harmonicMinor', 1, 4)).toBeNull();
    expect(() => diatonicChord(cMajor, 'major', 0)).toThrow(RangeError);
  });
});

describe('rhythm', () => {
  const quarter: Duration = { value: 4, dots: 0 };
  const eighth: Duration = { value: 8, dots: 0 };
  const dottedEighth: Duration = { value: 8, dots: 1 };
  const half: Duration = { value: 2, dots: 0 };
  const doubleDottedWhole: Duration = { value: 1, dots: 2 };
  const quarterTriplet: Duration = { value: 4, dots: 0, tuplet: { actual: 3, normal: 2 } };
  const eighthTriplet: Duration = { value: 8, dots: 0, tuplet: { actual: 3, normal: 2 } };
  const fourFour: TimeSignature = { beats: 4, unit: 4 };
  const sixEight: TimeSignature = { beats: 6, unit: 8 };

  it('converts durations to whole notes', () => {
    expect(durationInWholeNotes(quarter)).toBe(0.25);
    expect(durationInWholeNotes(half)).toBe(0.5);
    expect(durationInWholeNotes(dottedEighth)).toBe(0.1875);
    expect(durationInWholeNotes(doubleDottedWhole)).toBe(1.75);
    expect(durationInWholeNotes(quarterTriplet)).toBeCloseTo(1 / 6, 10);
  });

  it('computes measure length from time signature', () => {
    expect(measureLengthInWholeNotes(fourFour)).toBe(1);
    expect(measureLengthInWholeNotes({ beats: 3, unit: 4 })).toBe(0.75);
    expect(measureLengthInWholeNotes(sixEight)).toBe(0.75);
  });

  it('converts durations to ticks', () => {
    expect(durationTicks(quarter)).toBe(480);
    expect(durationTicks(dottedEighth)).toBe(360);
    expect(durationTicks(quarter, 960)).toBe(960);
    expect(durationTicks(quarterTriplet)).toBe(320);
    expect(durationTicks(eighthTriplet)).toBe(160);
    expect(durationTicks(quarterTriplet, 100)).toBeCloseTo(66.666666, 5);
    expect(() => durationTicks(quarter, 0)).toThrow(RangeError);
  });

  it('checks whether durations fill a measure', () => {
    expect(isMeasureComplete([quarter, quarter, quarter, quarter], fourFour)).toBe(true);
    expect(isMeasureComplete([half, half], fourFour)).toBe(true);
    expect(
      isMeasureComplete([eighth, eighth, eighth, eighth, eighth, eighth], sixEight),
    ).toBe(true);
    expect(isMeasureComplete([quarter, quarter, quarter], fourFour)).toBe(false);
    expect(isMeasureComplete([], fourFour)).toBe(false);
  });

  it('validates duration and time signature input', () => {
    expect(() => assertDuration(quarter)).not.toThrow();
    expect(() => assertDuration({ value: 3, dots: 0 } as unknown as Duration)).toThrow(
      RangeError,
    );
    expect(() => assertDuration({ value: 4, dots: 3 } as unknown as Duration)).toThrow(
      RangeError,
    );
    expect(() =>
      assertDuration({ value: 4, dots: 0, tuplet: { actual: 0, normal: 2 } }),
    ).toThrow(RangeError);
    expect(() =>
      assertDuration({ value: 4, dots: 0, tuplet: { actual: 3, normal: 3 } }),
    ).toThrow(RangeError);

    expect(() => assertTimeSignature(fourFour)).not.toThrow();
    expect(() => assertTimeSignature({ beats: 0, unit: 4 })).toThrow(RangeError);
    expect(() =>
      assertTimeSignature({ beats: 4, unit: 3 } as unknown as TimeSignature),
    ).toThrow(RangeError);
  });
});
