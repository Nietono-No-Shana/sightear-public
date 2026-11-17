import type { AnswerKey, NoteEvent } from '../ports';

type PerformanceKey = Extract<AnswerKey, { type: 'performance' }>;
interface SingingGroup { note: NoteEvent; indices: number[]; bridgedMs: number }

function targetFor(key: PerformanceKey, first: NoteEvent, last: NoteEvent): NoteEvent | undefined {
  if (key.timing === 'none') return key.notes.length === 1 ? key.notes[0] : undefined;
  return key.notes.find((target, index) => first.start >= target.start - key.policy.onsetMs &&
    first.start < target.start + target.dur && last.start < target.start + target.dur &&
    last.start + last.dur <= target.start + target.dur + key.policy.durationMs &&
    !key.notes.some((other, otherIndex) => otherIndex !== index && other.start + other.dur > first.start &&
      other.start <= last.start + key.policy.onsetMs));
}

function combine(key: PerformanceKey, group: SingingGroup, last: NoteEvent): NoteEvent | undefined {
  const first = group.note;
  const gap = last.start - first.start - first.dur;
  if (gap < 0 || group.bridgedMs + gap > 120) return;
  const target = targetFor(key, first, last);
  if (!target) return;
  const deviation = (note: NoteEvent): number => Math.abs((note.midi - target.midi) * 100 + note.cents - target.cents);
  const samePitch = first.midi === last.midi && Math.abs(first.cents - last.cents) <= 50;
  const attack = group.indices.length === 1 && first.dur <= 200 && gap <= 60 &&
    last.dur >= Math.max(240, first.dur * 2) && deviation(last) <= key.policy.pitchCents &&
    (key.timing === 'none' || Math.abs(first.start - target.start) <= key.policy.onsetMs);
  if (!samePitch && !attack) return;
  const representative = samePitch && deviation(first) > deviation(last) ? first : last;
  return { ...representative, start: first.start, dur: last.start + last.dur - first.start };
}

export function groupSingingFragments(key: PerformanceKey, notes: readonly NoteEvent[]): readonly SingingGroup[] {
  const groups: SingingGroup[] = [];
  notes.forEach((note, index) => {
    const previous = groups.at(-1);
    const merged = key.mode === 'sung' && key.policy.grading === 'graded-v2' && previous ? combine(key, previous, note) : undefined;
    if (merged) {
      previous!.bridgedMs += note.start - previous!.note.start - previous!.note.dur;
      previous!.note = merged; previous!.indices.push(index);
    } else groups.push({ note: { ...note }, indices: [index], bridgedMs: 0 });
  });
  if (key.mode !== 'sung' || key.policy.grading !== 'graded-v2') return groups;
  const normalized: SingingGroup[] = [];
  for (const group of groups) {
    const previous = normalized.at(-1);
    const merged = previous ? combine(key, previous, group.note) : undefined;
    if (merged) {
      previous!.bridgedMs += group.note.start - previous!.note.start - previous!.note.dur;
      previous!.note = merged;
      previous!.indices.push(...group.indices);
    } else normalized.push(group);
  }
  return normalized;
}

export interface ExpandedSinging {
  readonly notes: readonly NoteEvent[];
  readonly sources: readonly number[];
}

/**
 * Repeated notes on the same pitch are often sung as one continuous tone.
 * Split such a response at the expected note boundaries so the singer does not
 * have to insert a silence just to separate two identical targets.
 */
export function expandRepeatedTargets(key: PerformanceKey, notes: readonly NoteEvent[]): ExpandedSinging {
  if (key.mode !== 'sung' || key.policy.grading !== 'graded-v2' || key.timing === 'none') {
    return { notes, sources: notes.map((_, index) => index) };
  }
  const expanded: NoteEvent[] = [];
  const sources: number[] = [];
  notes.forEach((note, sourceIndex) => {
    const noteEnd = note.start + note.dur;
    let run: { start: number; dur: number; midi: number }[] | null = null;
    for (let index = 0; index < key.notes.length; index += 1) {
      const first = key.notes[index]!;
      if (first.midi !== note.midi) continue;
      const candidate = [{ start: first.start, dur: first.dur, midi: first.midi }];
      let cursor = index + 1;
      while (cursor < key.notes.length) {
        const current = key.notes[cursor]!;
        const previous = key.notes[cursor - 1]!;
        if (current.midi !== note.midi || current.start > previous.start + previous.dur + key.policy.onsetMs) break;
        candidate.push({ start: current.start, dur: current.dur, midi: current.midi });
        cursor += 1;
      }
      const last = candidate.at(-1)!;
      if (candidate.length >= 2 && first.start < noteEnd && last.start + last.dur > note.start - key.policy.durationMs) {
        run = candidate;
        break;
      }
      index = cursor - 1;
    }
    if (!run || run.length < 2) {
      expanded.push({ ...note });
      sources.push(sourceIndex);
      return;
    }
    const second = run[1]!;
    if (note.start >= second.start || noteEnd <= second.start + 30) {
      expanded.push({ ...note });
      sources.push(sourceIndex);
      return;
    }
    for (let index = 0; index < run.length; index += 1) {
      const start = index === 0 ? note.start : Math.max(note.start, run[index]!.start);
      const end = index === run.length - 1 ? noteEnd : Math.min(noteEnd, run[index + 1]!.start);
      if (end - start <= 0) continue;
      expanded.push({ midi: note.midi, cents: note.cents, start, dur: end - start });
      sources.push(sourceIndex);
    }
  });
  return { notes: expanded, sources };
}
