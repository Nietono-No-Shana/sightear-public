import type { Pitch, Rng, Score, ScoreGeneratorSpec, ScoreNote } from '../../ports';
import { rhythmBlocks } from '../../config';
import { durationTicks, LETTERS, NATURAL_SEMITONES, parsePitchName, makeSpelled, midiToPitch } from '../../theory';

export function constrainedRhythm(spec: ScoreGeneratorSpec, rng: Rng): { score: Score; counts: ReadonlyMap<string, number> } {
  const blocks = rhythmBlocks(spec);
  const length = 1920 * spec.time.beats / spec.time.unit;
  const reachable = new Set([0]);
  for (let cursor = 1; cursor <= length; cursor += 1) {
    if (blocks.some((block) => reachable.has(cursor - block.ticks))) reachable.add(cursor);
  }
  const counts = new Map<string, number>();
  const measures = Array.from({ length: spec.measures }, () => {
    const notes: ScoreNote[] = [];
    let remaining = length;
    while (remaining > 0) {
      const candidates = blocks.filter((block) => reachable.has(remaining - block.ticks));
      const needed = candidates.filter((block) => block.id !== null && (counts.get(block.id) ?? 0) < (spec.patterns?.find((pattern) => pattern.id === block.id)?.minOccurrences ?? 0));
      const pool = needed.length && rng.int(100) < 75 ? needed : candidates;
      const block = pool[rng.int(pool.length)]!;
      if (block.id !== null) counts.set(block.id, (counts.get(block.id) ?? 0) + 1);
      for (const event of block.notes) {
        const rest = event.rest ?? (rng.int(100) < spec.restProbability);
        notes.push({ pitch: rest ? null : midiToPitch(60), tie: false,
          duration: { ...event.duration, ...(event.duration.tuplet ? { tuplet: { ...event.duration.tuplet } } : {}) } });
      }
      remaining -= block.ticks;
    }
    return { key: { ...spec.key }, time: { ...spec.time }, voices: [{ notes }] };
  });
  return { score: { clef: spec.clef, measures }, counts };
}

function naturalPitch(midi: number, fifths: number): Pitch | null {
  const order = fifths < 0 ? 'BEADGCF' : 'FCGDAEB';
  for (const letter of LETTERS) {
    const accidental = order.indexOf(letter) < Math.abs(fifths) ? Math.sign(fifths) : 0;
    const offset = NATURAL_SEMITONES[letter] + accidental;
    if (((offset % 12) + 12) % 12 === midi % 12) return { midi, name: `${letter}${accidental < 0 ? 'b' : accidental > 0 ? '#' : ''}${(midi - offset) / 12 - 1}` };
  }
  return null;
}

function melodyCandidates(spec: Extract<ScoreGeneratorSpec, { kind: 'diatonic-melody' }>): readonly (Pitch & { degree: number })[] {
  const natural = spec.key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const constraints = spec.melody;
  const candidates: (Pitch & { degree: number })[] = [];
  for (let midi = 0; midi <= 127; midi += 1) {
    const degree = natural.indexOf((midi - spec.key.tonic + 120) % 12) + 1;
    if (!degree || (constraints && !constraints.degrees.includes(degree))) continue;
    const raise = ((constraints?.scale === 'harmonicMinor' && degree === 7) ||
      (constraints?.scale === 'melodicMinorAscending' && degree >= 6)) ? 1 : 0;
    if (midi + raise < spec.pitchRange[0] || midi + raise > spec.pitchRange[1]) continue;
    const base = parsePitchName(naturalPitch(midi, spec.key.fifths)!.name);
    if (!base) continue;
    const pitch = makeSpelled(base.letter, base.accidental + raise, base.octave);
    candidates.push({ midi: pitch.midi, name: pitch.name, degree });
  }
  return candidates;
}

export function assignConstrainedMelody(score: Score, spec: Extract<ScoreGeneratorSpec, { kind: 'diatonic-melody' }>, rng: Rng): boolean {
  const notes = score.measures.flatMap((measure) => measure.voices[0]!.notes);
  const attacks = notes.filter((note, index) => note.pitch !== null && !notes[index - 1]?.tie).length;
  if (!attacks) return false;
  const candidates = melodyCandidates(spec);
  const allowed = (first: Pitch, second: Pitch): boolean => Math.abs(first.midi - second.midi) <= spec.maxLeapSemitones &&
    (spec.melody?.allowRepeatedNotes !== false || first.midi !== second.midi);
  const suffix: number[][] = Array.from({ length: attacks }, () => []);
  suffix[attacks - 1] = candidates.flatMap((pitch, index) => !spec.melody || spec.melody.endDegrees.includes(pitch.degree) ? [index] : []);
  for (let position = attacks - 2; position >= 0; position -= 1) {
    suffix[position] = candidates.flatMap((pitch, index) => suffix[position + 1]!.some((next) => allowed(pitch, candidates[next]!)) ? [index] : []);
  }
  let previous: ScoreNote | undefined;
  let position = 0;
  let lastPitch: Pitch | undefined;
  for (const note of notes) {
    if (note.pitch !== null && previous?.tie) note.pitch = { ...previous.pitch! };
    else if (note.pitch !== null) {
      const feasible = suffix[position]!.filter((index) => lastPitch ? allowed(lastPitch, candidates[index]!)
        : !spec.melody || spec.melody.startDegrees.includes(candidates[index]!.degree));
      if (!feasible.length) return false;
      const pitch = candidates[feasible[rng.int(feasible.length)]!]!;
      note.pitch = { midi: pitch.midi, name: pitch.name };
      lastPitch = note.pitch;
      position += 1;
    }
    previous = note;
  }
  return true;
}

export function satisfiesGenerationRequirements(score: Score, spec: ScoreGeneratorSpec, counts: ReadonlyMap<string, number>): boolean {
  if (spec.patterns?.some((pattern) => (counts.get(pattern.id) ?? 0) < pattern.minOccurrences)) return false;
  let dottedNotes = 0;
  let tripletNotes = 0;
  let withinMeasureTies = 0;
  let acrossMeasureTies = 0;
  let sounding = 0;
  for (const measure of score.measures) {
    const notes = measure.voices[0]!.notes;
    for (const [index, note] of notes.entries()) {
      if (note.pitch) {
        sounding += 1;
        if (note.duration.dots > 0) dottedNotes += 1;
      }
      if (note.duration.tuplet) tripletNotes += 1;
      if (note.tie && index === notes.length - 1) acrossMeasureTies += 1;
      else if (note.tie) withinMeasureTies += 1;
    }
  }
  const actual = { dottedNotes, tripletGroups: tripletNotes / 3, withinMeasureTies, acrossMeasureTies };
  return sounding > 0 && Object.entries(spec.required ?? {}).every(([key, count]) => actual[key as keyof typeof actual] >= count);
}
