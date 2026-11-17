import type { AnswerKey, ErrorType, Judgement, NoteDifference, NoteEvent, Response } from '../ports';
import { validatePerformancePolicy } from '../config';
import { scoreTimeline } from '../theory';
import { alignSequences } from './alignment';
import { deviationCredit } from './credit';
import { groupSingingFragments, expandRepeatedTargets } from './singing-fragments';

type PerformanceKey = Extract<AnswerKey, { type: 'performance' }>;

function validNotes(notes: readonly NoteEvent[]): void {
  if (notes.length > 512) throw new RangeError('too many performance events');
  notes.forEach((note, index) => {
    if (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127 || !Number.isFinite(note.cents) ||
        !Number.isFinite(note.start) || !Number.isFinite(note.dur) || note.dur <= 0 ||
        (index > 0 && note.start < notes[index - 1]!.start)) throw new RangeError('invalid performance event');
  });
}

function difference(key: PerformanceKey, expected: NoteEvent, actual: NoteEvent, expectedIndex: number, responseIndex: number): NoteDifference {
  const cents = (actual.midi - expected.midi) * 100 + actual.cents - expected.cents;
  const onset = actual.start - expected.start;
  const duration = actual.dur - expected.dur;
  const errors: ErrorType[] = [];
  if (!key.rhythmOnly && Math.abs(cents) > key.policy.pitchCents + 1e-7) errors.push('pitch');
  if (key.timing !== 'none' && (Math.abs(onset) > key.policy.onsetMs + 1e-7 ||
      (key.timing === 'full' && Math.abs(duration) > key.policy.durationMs + 1e-7))) errors.push('rhythm');
  const graded = key.mode !== 'notation' && key.policy.grading !== undefined;
  const pitchScore = graded ? deviationCredit(cents, key.policy.pitchCents, 'pitch', key.policy.grading) : Number(!errors.includes('pitch'));
  const onsetCredit = deviationCredit(onset, key.policy.onsetMs, 'timing', key.policy.grading);
  const rhythmScore = graded ? key.timing === 'full'
    ? (onsetCredit + deviationCredit(duration, key.policy.durationMs, 'timing', key.policy.grading)) / 2 : onsetCredit
    : Number(!errors.includes('rhythm'));
  return { expectedIndex, responseIndex, errors, cents: key.rhythmOnly ? null : cents,
    ...(!key.rhythmOnly ? { pitchScore } : {}), ...(key.timing !== 'none' ? { rhythmScore } : {}),
    onsetErrorMs: key.timing === 'none' ? null : onset, durationErrorMs: key.timing === 'full' ? duration : null };
}

function absent(expectedIndex: number | null, responseIndex: number | null): NoteDifference {
  return { expectedIndex, responseIndex, errors: [expectedIndex === null ? 'extra' : 'omission'], cents: null, onsetErrorMs: null, durationErrorMs: null };
}

function responseNotes(key: PerformanceKey, response: Response): { notes: readonly NoteEvent[]; end?: number } {
  if (response.kind !== key.mode) throw new RangeError('response does not match performance task');
  if (response.kind === 'notation') return scoreTimeline(response.score, key.tempoBpm, true);
  if (response.kind === 'sung') {
    if (!response.notes.length) throw new RangeError('no usable singing input');
    return { notes: response.notes };
  }
  if (response.kind === 'tapped') {
    if (!response.onsets.length) throw new RangeError('no usable tapping input');
    return { notes: response.onsets.map((start) => ({ midi: 60, start, dur: 1, cents: 0 })) };
  }
  throw new RangeError('unsupported performance response');
}

export function judgePerformance(key: PerformanceKey, response: Response): Judgement {
  validatePerformancePolicy(key.policy);
  validNotes(key.notes);
  if (!key.notes.length || !Number.isFinite(key.end) || key.end <= 0) throw new RangeError('invalid performance answer');
  const input = responseNotes(key, response);
  validNotes(input.notes);
  const sourceNotes = key.timing === 'none' && key.notes.length === 1 && input.notes.length > 1
    ? [input.notes.reduce((best, note) => (note.dur > best.dur ? note : best))]
    : input.notes;
  const calibrated = sourceNotes.map((note) => ({ ...note, start: note.start - key.policy.latencyMs }));
  const shift = key.policy.alignStart && calibrated.length ? calibrated[0]!.start - key.notes[0]!.start : 0;
  const expanded = expandRepeatedTargets(key, calibrated.map((note) => ({ ...note, start: note.start - shift })));
  const groups = groupSingingFragments(key, expanded.notes);
  const actual = groups.map((group) => group.note);
  const differences = key.notes.map((expected, expectedIndex) => actual.map((note, actualIndex) => difference(key, expected, note, expectedIndex, actualIndex)));
  const alignment = alignSequences(key.notes.length, actual.length, (expected, actualIndex) => {
    const detail = differences[expected]![actualIndex]!;
    if (!detail.errors.length) return 0;
    return 1.25 + Math.min(0.5, Math.abs(detail.onsetErrorMs ?? 0) / 10_000);
  });
  const details = alignment.map(({ expected, actual: actualIndex }) => {
    const detail = expected === null || actualIndex === null ? absent(expected, actualIndex) : differences[expected]![actualIndex]!;
    return actualIndex === null ? detail : { ...detail, responseIndex: expanded.sources[groups[actualIndex]!.indices[0]!]!,
      ...(groups[actualIndex]!.indices.length > 1 ? { responseIndices: groups[actualIndex]!.indices.map((index) => expanded.sources[index]!) } : {}) };
  });
  const endMismatch = input.end !== undefined && Math.abs(input.end - key.end) > 1e-7;
  if (endMismatch) details.push(absent(input.end! < key.end ? key.notes.length : null, input.end! > key.end ? actual.length : null));
  const denominator = Math.max(key.notes.length, actual.length) + (endMismatch ? 1 : 0);
  const matches = details.filter((detail) => detail.expectedIndex !== null && detail.responseIndex !== null);
  const pitchScore = matches.reduce((sum, detail) => sum + (detail.pitchScore ?? 0), 0) / denominator;
  const rhythmScore = matches.reduce((sum, detail) => sum + (detail.rhythmScore ?? 0), 0) / denominator;
  const correct = details.every((detail) => detail.errors.length === 0);
  const partial = key.rhythmOnly ? rhythmScore : key.timing === 'none' ? pitchScore : (pitchScore + rhythmScore) / 2;
  return {
    correct, partial, errorType: details.flatMap((detail) => detail.errors)[0] ?? 'none', confusion: null,
    cents: key.rhythmOnly ? null : matches.map((detail) => detail.cents!), rtMs: response.rtMs, details,
    ...(!key.rhythmOnly ? { pitchScore } : {}), ...(key.timing !== 'none' ? { rhythmScore } : {}),
  };
}
