import type { Duration, Pitch, Rng, Score, ScoreGeneratorSpec, ScoreMeasure, ScoreNote } from '../../ports';
import { durationTicks, midiToPitch, LETTERS, NATURAL_SEMITONES, scoreTimeline } from '../../theory';
import { validateScoreGenerator } from '../../config';
import { assignConstrainedMelody, constrainedRhythm, satisfiesGenerationRequirements } from './advanced';

const TICKS_PER_WHOLE = 1920;
const MAX_GENERATED_NOTES = 256;
const MAX_PITCH_ATTEMPTS = 32;
const MAX_SCORE_ATTEMPTS = 64;
const SCALE_STEPS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
} as const;

function durationPool(spec: ScoreGeneratorSpec): readonly { duration: Duration; ticks: number; count: number }[] {
  return spec.durations.map((duration) => {
    const count = duration.tuplet ? 3 : 1;
    return { duration, ticks: durationTicks(duration) * count, count };
  });
}

function canFill(target: number, pool: readonly { ticks: number }[]): (remaining: number) => boolean {
  const memo = new Map<number, boolean>([[0, true]]);
  const visit = (remaining: number): boolean => {
    const cached = memo.get(remaining);
    if (cached !== undefined) return cached;
    const possible = pool.some(({ ticks }) => ticks <= remaining && visit(remaining - ticks));
    memo.set(remaining, possible);
    return possible;
  };
  if (!visit(target)) throw new RangeError('generator durations cannot fill the measure');
  return visit;
}

function fillMeasure(spec: ScoreGeneratorSpec, pool: ReturnType<typeof durationPool>, rng: Rng): ScoreNote[] {
  const target = TICKS_PER_WHOLE * spec.time.beats / spec.time.unit;
  const canComplete = canFill(target, pool);
  const notes: ScoreNote[] = [];
  let remaining = target;
  while (remaining > 0) {
    const candidates = pool.filter(({ ticks }) => ticks <= remaining && canComplete(remaining - ticks));
    const selected = candidates[rng.int(candidates.length)]!;
    for (let index = 0; index < selected.count; index += 1) {
      const rest = rng.int(100) < spec.restProbability;
      const duration = { ...selected.duration, ...(selected.duration.tuplet ? { tuplet: { ...selected.duration.tuplet } } : {}) };
      notes.push({ pitch: rest ? null : midiToPitch(60), duration, tie: false });
    }
    remaining -= selected.ticks;
  }
  if (notes.every((note) => note.pitch === null)) notes[0]!.pitch = midiToPitch(60);
  return notes;
}

function scalePitches(spec: Extract<ScoreGeneratorSpec, { kind: 'diatonic-melody' }>): number[] {
  const [low, high] = spec.pitchRange;
  const pitchClasses = new Set(SCALE_STEPS[spec.key.mode].map((step) => (spec.key.tonic + step) % 12));
  const pitches = Array.from({ length: high - low + 1 }, (_, index) => low + index)
    .filter((midi) => pitchClasses.has(midi % 12));
  if (pitches.length === 0) throw new RangeError('melody pitch range contains no pitches in the selected key');
  return pitches;
}

function melodyPitches(
  notes: readonly ScoreNote[],
  candidates: readonly number[],
  spec: Extract<ScoreGeneratorSpec, { kind: 'diatonic-melody' }>,
  rngFactory: (label: string) => Rng,
): number[] {
  const sounding = notes.filter((note, index) => note.pitch !== null && !notes[index - 1]?.tie).length;
  for (let attempt = 0; attempt < MAX_PITCH_ATTEMPTS; attempt += 1) {
    const rng = rngFactory(`pitch:${attempt}`);
    const selected: number[] = [];
    for (let index = 0; index < sounding; index += 1) {
      const feasible = index === 0 ? candidates : candidates.filter((pitch) => Math.abs(pitch - selected[index - 1]!) <= spec.maxLeapSemitones);
      if (feasible.length === 0) break;
      selected.push(feasible[rng.int(feasible.length)]!);
    }
    if (selected.length === sounding) return selected;
  }
  throw new RangeError('melody constraints could not produce a complete pitch sequence');
}

function makeMeasure(spec: ScoreGeneratorSpec, notes: ScoreNote[]): ScoreMeasure {
  return { key: { ...spec.key }, time: { ...spec.time }, voices: [{ notes }] };
}

function spelledPitch(midi: number, fifths: number): Pitch {
  const order = fifths < 0 ? 'BEADGCF' : 'FCGDAEB';
  for (const letter of LETTERS) {
    const accidental = order.indexOf(letter) < Math.abs(fifths) ? Math.sign(fifths) : 0;
    const offset = NATURAL_SEMITONES[letter] + accidental;
    if (((offset % 12) + 12) % 12 !== midi % 12) continue;
    const octave = (midi - offset) / 12 - 1;
    return { midi, name: `${letter}${accidental < 0 ? 'b' : accidental > 0 ? '#' : ''}${octave}` };
  }
  throw new RangeError('generated pitch is outside the key');
}

function generateScoreCandidate(spec: ScoreGeneratorSpec, rng: Rng): Score {
  const pool = durationPool(spec);
  const maxPerMeasure = Math.floor((TICKS_PER_WHOLE * spec.time.beats / spec.time.unit) / Math.min(...pool.map(({ ticks, count }) => ticks / count)));
  if (maxPerMeasure * spec.measures > MAX_GENERATED_NOTES) throw new RangeError('generator may exceed 256 score events');
  const measures = Array.from({ length: spec.measures }, (_, index) => {
    const notes = fillMeasure(spec, pool, rng.fork(`measure:${index}`));
    return makeMeasure(spec, notes);
  });
  if (spec.version === 2 && spec.ties) applyTies(measures, spec.ties, rng.fork('ties'));
  if (spec.kind === 'diatonic-melody') {
    const pitches = melodyPitches(measures.flatMap((measure) => measure.voices[0]!.notes), scalePitches(spec), spec, (label) => rng.fork(label));
    let index = 0;
    let previous: ScoreNote | undefined;
    for (const measure of measures) {
      for (const note of measure.voices[0]!.notes) {
        if (note.pitch !== null) note.pitch = previous?.tie ? { ...previous.pitch! } : spelledPitch(pitches[index++]!, spec.key.fifths);
        previous = note;
      }
    }
  }
  return { clef: spec.clef, measures };
}

function applyTies(measures: readonly ScoreMeasure[], ties: NonNullable<ScoreGeneratorSpec['ties']>, rng: Rng): void {
  const positions = measures.flatMap((measure, measureIndex) => measure.voices[0]!.notes.map((note) => ({ note, measureIndex })));
  for (let index = 0; index < positions.length - 1; index += 1) {
    const current = positions[index]!;
    const next = positions[index + 1]!;
    if (current.note.pitch === null || next.note.pitch === null) continue;
    const probability = current.measureIndex === next.measureIndex ? ties.withinMeasureProbability : ties.acrossMeasureProbability;
    current.note.tie = rng.int(100) < probability;
  }
}

function hasCorrectionTarget(score: Score, shiftTicks: number): boolean {
  return scoreTimeline(score, 60).notes.slice(1).some((note) => note.dur > shiftTicks * 1000 / 480);
}

export function generateScore(spec: ScoreGeneratorSpec, rng: Rng, correctionShiftTicks?: number): Score {
  validateScoreGenerator(spec, correctionShiftTicks !== undefined ? 'rhythm-correction'
    : spec?.kind === 'diatonic-melody' ? 'melody-dictation' : 'rhythm-dictation', 90, correctionShiftTicks);
  for (let attempt = 0; attempt < (spec.version === 3 ? 128 : MAX_SCORE_ATTEMPTS); attempt += 1) {
    const candidateRng = rng.fork(`candidate:${attempt}`);
    let score: Score;
    if (spec.version === 3) {
      const result = constrainedRhythm(spec, candidateRng.fork('rhythm'));
      score = result.score;
      if (spec.ties) applyTies(score.measures, spec.ties, candidateRng.fork('ties'));
      if (!satisfiesGenerationRequirements(score, spec, result.counts)) continue;
      if (spec.kind === 'diatonic-melody' && !assignConstrainedMelody(score, spec, candidateRng.fork('melody'))) continue;
    } else score = generateScoreCandidate(spec, candidateRng);
    if (correctionShiftTicks === undefined || hasCorrectionTarget(score, correctionShiftTicks)) return score;
  }
  if (spec.version === 3) throw new RangeError('generation constraints unsatisfied after 128 attempts; simplify the rule without removing its training target');
  throw new RangeError('generator could not produce a valid rhythm-correction target');
}
