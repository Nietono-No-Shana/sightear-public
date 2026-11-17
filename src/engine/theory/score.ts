import type { NoteEvent, Score } from '../ports';
import { parsePitchName } from './pitch';
import { durationTicks, measureLengthInWholeNotes } from './rhythm';

const MAJOR_TONICS_BY_FIFTHS = [
  [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1],
  [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10],
] as const;

export interface TimedScoreNote extends NoteEvent {
  readonly scoreIndex: number;
}

export function scoreTimeline(score: Score, tempoBpm: number, allowIncomplete = false): {
  notes: readonly TimedScoreNote[]; end: number; size: number;
} {
  if (!Number.isFinite(tempoBpm) || tempoBpm <= 0 || tempoBpm > 400) throw new RangeError('invalid score tempo');
  if (!['treble', 'bass', 'grand'].includes(score.clef) || score.measures.length > 64 ||
      (!allowIncomplete && score.measures.length === 0)) throw new RangeError('invalid score measures');
  const notes: TimedScoreNote[] = [];
  const tickMs = 60_000 / tempoBpm / 480;
  let cursor = 0;
  let scoreIndex = 0;
  let tied = false;
  for (const measure of score.measures) {
    const length = measureLengthInWholeNotes(measure.time) * 1920;
    if (!Number.isInteger(length) || measure.time.beats > 32 || measure.voices.length !== 1) throw new RangeError('expected a bounded single voice');
    if (!Number.isInteger(measure.key.tonic) || measure.key.tonic < 0 || measure.key.tonic > 11 ||
        !['major', 'minor'].includes(measure.key.mode) || !Number.isInteger(measure.key.fifths) || Math.abs(measure.key.fifths) > 7) throw new RangeError('invalid key');
    const keyTonic = MAJOR_TONICS_BY_FIFTHS[measure.key.mode === 'major' ? 0 : 1][measure.key.fifths + 7];
    if (keyTonic !== measure.key.tonic) throw new RangeError('key tonic and fifths disagree');
    if (!Number.isInteger(measure.time.beats) || measure.time.beats < 1 || measure.time.beats > 32 ||
        (measure.time.unit !== 2 && measure.time.unit !== 4 && measure.time.unit !== 8)) throw new RangeError('invalid time signature');
    let used = 0;
    for (const note of measure.voices[0]!.notes) {
      const ticks = durationTicks(note.duration);
      if (typeof note.tie !== 'boolean') throw new RangeError('invalid tie');
      if (!Number.isSafeInteger(ticks) || ticks <= 0 || used + ticks > length) throw new RangeError('invalid score duration or measure overflow');
      if (note.pitch !== null && parsePitchName(note.pitch.name)?.midi !== note.pitch.midi) throw new RangeError('inconsistent score pitch');
      if (note.pitch === null && (note.tie || tied)) throw new RangeError('rest cannot be tied');
      if (note.pitch !== null) {
        const previous = notes[notes.length - 1];
        if (tied) {
          if (!previous || previous.midi !== note.pitch.midi) throw new RangeError('tie must continue the same pitch');
          previous.dur += ticks * tickMs;
        } else {
          notes.push({ midi: note.pitch.midi, cents: 0, start: (cursor + used) * tickMs, dur: ticks * tickMs, scoreIndex });
        }
      }
      tied = note.tie;
      used += ticks;
      scoreIndex += 1;
    }
    if (used !== length && (!allowIncomplete || tied)) throw new RangeError('incomplete score measure');
    cursor += length;
  }
  if (tied) throw new RangeError('unfinished tie');
  return { notes, end: cursor * tickMs, size: scoreIndex };
}
