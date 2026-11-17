import type { Lesson, Score, VocalRangeId, VocalBounds } from '../ports';

export const VOCAL_RANGES = [
  { id: 'original', label: '原音区', low: 0, high: 127, center: 60 },
  { id: 'soprano', label: '女高（练习预设）', low: 60, high: 76, center: 69 },
  { id: 'mezzo', label: '女中（练习预设）', low: 57, high: 72, center: 65 },
  { id: 'alto', label: '女低（练习预设）', low: 53, high: 69, center: 60 },
  { id: 'tenor', label: '男高（练习预设）', low: 48, high: 64, center: 54 },
  { id: 'baritone', label: '男中（练习预设）', low: 43, high: 60, center: 50 },
  { id: 'bass', label: '男低（练习预设）', low: 40, high: 57, center: 46 },
] as const;

export type { VocalRangeId } from '../ports';

export function vocalOctaves(midis: readonly number[], voice: VocalRangeId, bounds?: VocalBounds): number {
  if (bounds && (!Number.isInteger(bounds.low) || !Number.isInteger(bounds.high) || bounds.low < 0 || bounds.high > 127 || bounds.low >= bounds.high)) throw new RangeError('invalid comfortable range');
  if (voice === 'original' || !midis.length) return 0;
  const range = bounds ? { ...bounds, center: (bounds.low + bounds.high) / 2 } : VOCAL_RANGES.find((entry) => entry.id === voice)!;
  const low = Math.min(...midis);
  const high = Math.max(...midis);
  const candidates = Array.from({ length: 21 }, (_, index) => index - 10)
    .filter((octaves) => low + octaves * 12 >= 0 && high + octaves * 12 <= 127);
  const cost = (octaves: number): number => {
    const shift = octaves * 12;
    return (Math.max(0, range.low - low - shift) + Math.max(0, high + shift - range.high)) * 1000
      + Math.abs((low + high) / 2 + shift - range.center);
  };
  return candidates.sort((first, second) => cost(first) - cost(second) || Math.abs(first) - Math.abs(second))[0]!;
}

function vocalScore(score: Score, voice: VocalRangeId, bounds?: VocalBounds): Score {
  const pitches = score.measures.flatMap((measure) => measure.voices.flatMap((part) => part.notes.flatMap((note) => note.pitch ? [note.pitch.midi] : [])));
  const octaves = vocalOctaves(pitches, voice, bounds);
  const clef = (Math.min(...pitches) + Math.max(...pitches)) / 2 + octaves * 12 < 60 ? 'bass' : 'treble';
  return { ...score, clef, measures: score.measures.map((measure) => ({ ...measure,
    voices: measure.voices.map((part) => ({ ...part, notes: part.notes.map((note) => ({ ...note,
      pitch: note.pitch ? { midi: note.pitch.midi + octaves * 12,
        name: note.pitch.name.replace(/(-?\d+)$/, (value) => String(Number(value) + octaves)) } : null,
    })) })),
  })) };
}

export function vocalLesson(lesson: Lesson, voice: VocalRangeId, bounds?: VocalBounds): Lesson {
  const spec = lesson.exerciseSpec;
  if (voice === 'original' || !spec) return lesson;
  const id = `${spec.id}:voice-${voice}-v2${bounds ? `-${bounds.low}-${bounds.high}` : ''}`;
  if (spec.kind === 'interval-singing') {
    const pitches = spec.roots.flatMap((root) => [root, ...spec.intervals.map((interval) => root + (interval.direction === 'asc' ? 1 : -1) * interval.semitones)]);
    const shift = vocalOctaves(pitches, voice, bounds) * 12;
    return { ...lesson, id, exerciseSpec: { ...spec, id, roots: spec.roots.map((root) => root + shift) } };
  }
  if (spec.kind !== 'melody-singing' && spec.kind !== 'melody-imitation') return lesson;
  if (spec.generator?.kind === 'diatonic-melody') {
    const shift = vocalOctaves(spec.generator.pitchRange, voice, bounds) * 12;
    const pitchRange: [number, number] = [spec.generator.pitchRange[0] + shift, spec.generator.pitchRange[1] + shift];
    const center = (pitchRange[0] + pitchRange[1]) / 2;
    return { ...lesson, id, exerciseSpec: { ...spec, id, generator: { ...spec.generator, pitchRange, clef: center < 60 ? 'bass' : 'treble' } } };
  }
  return { ...lesson, id, exerciseSpec: { ...spec, id, scores: spec.scores.map((score) => vocalScore(score, voice, bounds)) } };
}
