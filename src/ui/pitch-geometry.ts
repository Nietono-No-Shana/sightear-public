import type { Clef, Duration } from '../engine/ports';

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const;
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const;
const TREBLE_SHARP_OCTAVES = [5, 5, 5, 5, 4, 5, 4] as const;
const TREBLE_FLAT_OCTAVES = [4, 5, 4, 5, 4, 5, 4] as const;
const BASS_SHARP_OCTAVES = [3, 3, 3, 3, 2, 3, 2] as const;
const BASS_FLAT_OCTAVES = [2, 3, 2, 3, 2, 3, 3] as const;

export interface KeySignatureMark {
  readonly letter: string;
  readonly octave: number;
  readonly step: number;
}

/** Staff step for each accidental in a key signature; step 0 is the bottom line. */
export function keySignatureMarks(fifths: number, clef: Clef): readonly KeySignatureMark[] {
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7 || fifths === 0) return [];
  const sharp = fifths > 0;
  const order = sharp ? SHARP_ORDER : FLAT_ORDER;
  const octaves = sharp
    ? (clef === 'bass' ? BASS_SHARP_OCTAVES : TREBLE_SHARP_OCTAVES)
    : (clef === 'bass' ? BASS_FLAT_OCTAVES : TREBLE_FLAT_OCTAVES);
  const bottom = clef === 'bass' ? 18 : 30;
  return order.slice(0, Math.abs(fifths)).map((letter, index) => {
    const octave = octaves[index]!;
    return { letter, octave, step: octave * 7 + 'CDEFGAB'.indexOf(letter) - bottom };
  });
}

export function durationBeats(duration: Duration): number {
  return 4 / duration.value * [1, 1.5, 1.75][duration.dots]!
    * (duration.tuplet ? duration.tuplet.normal / duration.tuplet.actual : 1);
}

export function staffPosition(name: string): number | null {
  const match = /^([A-G])([#b]*)(-?\d+)$/.exec(name);
  return match ? Number(match[3]) * 7 + 'CDEFGAB'.indexOf(match[1]!) : null;
}

export function pitchPosition(midi: number, reference?: { midi: number; position: number }): number {
  const naturals = [0, 2, 4, 5, 7, 9, 11];
  const center = Math.floor(midi / 12) - 1;
  const anchors: { midi: number; position: number }[] = [];
  for (let octave = center - 2; octave <= center + 2; octave += 1) {
    for (const [degree, semitone] of naturals.entries()) {
      const position = octave * 7 + degree;
      const pitch = position === reference?.position ? reference.midi : (octave + 1) * 12 + semitone;
      if (reference && position !== reference.position
        && (position - reference.position) * (pitch - reference.midi) <= 0) continue;
      anchors.push({ midi: pitch, position });
    }
  }
  const next = anchors.findIndex((anchor) => anchor.midi > midi);
  const before = anchors[next - 1]!;
  const after = anchors[next]!;
  return before.position + (after.position - before.position) * (midi - before.midi) / (after.midi - before.midi);
}

export function timelineX(time: number, points: readonly { time: number; x: number }[]): number {
  const next = points.findIndex((point) => point.time > time);
  if (next === 0) return points[0]!.x;
  if (next < 0) return points[points.length - 1]!.x;
  const before = points[next - 1]!;
  const after = points[next]!;
  return before.x + (after.x - before.x) * (time - before.time) / (after.time - before.time);
}
