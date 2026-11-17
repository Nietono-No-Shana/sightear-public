import type { Duration, RhythmPattern, ScoreGeneratorSpec } from '../ports';
import { durationTicks } from '../theory';

export interface RhythmBlock {
  id: string | null;
  notes: readonly { duration: Duration; rest: boolean | null }[];
  ticks: number;
}

export function rhythmBlocks(spec: ScoreGeneratorSpec): readonly RhythmBlock[] {
  const ordinary: RhythmBlock[] = spec.durations.map((duration) => {
    const notes = Array.from({ length: duration.tuplet ? 3 : 1 }, () => ({ duration, rest: null }));
    return { id: null, notes, ticks: notes.length * durationTicks(duration) };
  });
  return [...ordinary, ...(spec.patterns ?? []).map((pattern) => ({ id: pattern.id,
    notes: pattern.notes, ticks: pattern.notes.reduce((total, note) => total + durationTicks(note.duration), 0) }))];
}

function exactKeys(value: object, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new RangeError('unsupported generation rule field');
}

function validatePatternNotes(notes: readonly { duration: Duration; rest: boolean }[]): void {
  if (!Array.isArray(notes) || !notes.length || notes.length > 32) throw new RangeError('pattern requires 1..32 notes');
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index]!;
    if (!note || !note.duration || typeof note.rest !== 'boolean') throw new RangeError('invalid pattern note');
    exactKeys(note, ['duration', 'rest']);
    exactKeys(note.duration, ['value', 'dots', 'tuplet']);
    const ticks = durationTicks(note.duration);
    if (!Number.isSafeInteger(ticks) || ticks <= 0) throw new RangeError('pattern duration requires integral ticks');
    if (note.duration.tuplet) {
      exactKeys(note.duration.tuplet, ['actual', 'normal']);
      if (note.duration.dots !== 0 || note.duration.tuplet.actual !== 3 || note.duration.tuplet.normal !== 2) throw new RangeError('pattern supports only undotted 3:2 triplets');
      const group = notes.slice(index, index + 3);
      if (group.length !== 3 || group.some((entry) => !entry || typeof entry.rest !== 'boolean' || !entry.duration ||
          entry.duration.value !== note.duration.value || entry.duration.dots !== 0 || entry.duration.tuplet?.actual !== 3 || entry.duration.tuplet?.normal !== 2)) {
        throw new RangeError('pattern must contain complete triplet groups');
      }
      for (const entry of group) {
        exactKeys(entry, ['duration', 'rest']);
        exactKeys(entry.duration, ['value', 'dots', 'tuplet']);
        exactKeys(entry.duration.tuplet!, ['actual', 'normal']);
      }
      index += 2;
    }
  }
}

export function validateAdvancedGeneration(spec: ScoreGeneratorSpec): void {
  const measureTicks = 1920 * spec.time.beats / spec.time.unit;
  if (spec.patterns !== undefined) {
    if (!Array.isArray(spec.patterns) || !spec.patterns.length || spec.patterns.length > 32) throw new RangeError('patterns require 1..32 entries');
    const ids = new Set<string>();
    for (const pattern of spec.patterns as readonly RhythmPattern[]) {
      if (!pattern || typeof pattern.id !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(pattern.id) || ids.has(pattern.id) ||
          !Number.isInteger(pattern.minOccurrences) || pattern.minOccurrences < 0 || pattern.minOccurrences > 64) throw new RangeError('invalid pattern identity or count');
      exactKeys(pattern, ['id', 'notes', 'minOccurrences']);
      ids.add(pattern.id);
      validatePatternNotes(pattern.notes);
      if (pattern.notes.reduce((total, note) => total + durationTicks(note.duration), 0) > measureTicks) throw new RangeError('pattern exceeds measure');
    }
    const minimumTicks = (spec.patterns as readonly RhythmPattern[]).reduce((total, pattern) => total + pattern.minOccurrences * pattern.notes.reduce((ticks, note) => ticks + durationTicks(note.duration), 0), 0);
    if (minimumTicks > measureTicks * spec.measures) throw new RangeError('required patterns exceed score length');
  }
  if (spec.required !== undefined) {
    if (!spec.required || typeof spec.required !== 'object') throw new RangeError('invalid required features');
    exactKeys(spec.required, ['dottedNotes', 'tripletGroups', 'withinMeasureTies', 'acrossMeasureTies']);
    if (Object.values(spec.required).some((value) => !Number.isInteger(value) || value < 0 || value > 256)) throw new RangeError('invalid required feature count');
    const blocks = rhythmBlocks(spec);
    if ((spec.required.dottedNotes ?? 0) > 0 && !blocks.some((block) => block.notes.some((note) => note.rest !== true && note.duration.dots > 0))) throw new RangeError('required dotted notes have no candidates');
    if ((spec.required.tripletGroups ?? 0) > 0 && !blocks.some((block) => block.notes.some((note) => note.duration.tuplet))) throw new RangeError('required triplets have no candidates');
    if ((spec.required.withinMeasureTies ?? 0) > 0 && !spec.ties?.withinMeasureProbability) throw new RangeError('required within-measure ties are disabled');
    if ((spec.required.acrossMeasureTies ?? 0) > spec.measures - 1 || ((spec.required.acrossMeasureTies ?? 0) > 0 && !spec.ties?.acrossMeasureProbability)) throw new RangeError('required cross-measure ties are impossible');
  }
  if (spec.kind !== 'diatonic-melody' || spec.melody === undefined) return;
  const melody = spec.melody;
  if (!melody || typeof melody !== 'object') throw new RangeError('invalid melody constraints');
  exactKeys(melody, ['scale', 'degrees', 'startDegrees', 'endDegrees', 'allowRepeatedNotes']);
  if (!['major', 'naturalMinor', 'harmonicMinor', 'melodicMinorAscending'].includes(melody.scale) ||
      (melody.scale === 'major') !== (spec.key.mode === 'major') || typeof melody.allowRepeatedNotes !== 'boolean') throw new RangeError('melody scale conflicts with key');
  for (const degrees of [melody.degrees, melody.startDegrees, melody.endDegrees]) {
    if (!Array.isArray(degrees) || !degrees.length || degrees.length > 7 || new Set(degrees).size !== degrees.length ||
        degrees.some((degree) => !Number.isInteger(degree) || degree < 1 || degree > 7)) throw new RangeError('invalid melody degrees');
  }
  if ([...melody.startDegrees, ...melody.endDegrees].some((degree) => !melody.degrees.includes(degree))) throw new RangeError('endpoint degrees must be allowed');
}
