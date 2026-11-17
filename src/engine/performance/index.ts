import type { NoteEvent, PitchFrame } from '../ports';

export function estimatePitch(samples: Float32Array, sampleRate: number, t: number): PitchFrame {
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || !Number.isFinite(t) || samples.length < 256) throw new RangeError('invalid audio frame');
  let mean = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new RangeError('invalid audio sample');
    mean += sample;
  }
  mean /= samples.length;
  const centered = samples.map((sample) => sample - mean);
  const rms = Math.sqrt(centered.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  if (rms < 0.008) return { t, f0: 0, clarity: 0, rms };
  const minimum = Math.floor(sampleRate / 1000);
  const maximum = Math.min(Math.floor(sampleRate / 70), Math.floor(samples.length / 2));
  const normalized: number[] = [1];
  let cumulative = 0;
  for (let lag = 1; lag <= maximum; lag += 1) {
    let sum = 0;
    for (let index = 0; index < samples.length - maximum; index += 1) {
      const difference = centered[index]! - centered[index + lag]!;
      sum += difference * difference;
    }
    cumulative += sum;
    normalized[lag] = cumulative === 0 ? 1 : sum * lag / cumulative;
  }
  for (let lag = minimum; lag < maximum - 1; lag += 1) {
    if (normalized[lag]! >= 0.15) continue;
    while (lag < maximum - 1 && normalized[lag + 1]! < normalized[lag]!) lag += 1;
    const previous = normalized[lag - 1]!;
    const current = normalized[lag]!;
    const next = normalized[lag + 1]!;
    const denominator = previous - 2 * current + next;
    const offset = denominator === 0 ? 0 : Math.max(-1, Math.min(1, 0.5 * (previous - next) / denominator));
    return { t, f0: sampleRate / (lag + offset), clarity: 1 - current, rms };
  }
  return { t, f0: 0, clarity: 0, rms };
}

export function pitchFromFrame(frame: PitchFrame): number | null {
  if (![frame.f0, frame.clarity, frame.rms].every(Number.isFinite) || frame.f0 <= 0 || frame.clarity < 0.85 || frame.clarity > 1 || frame.rms < 0.008) return null;
  const pitch = 69 + 12 * Math.log2(frame.f0 / 440);
  return Number.isFinite(pitch) && pitch >= 0 && pitch <= 127 ? pitch : null;
}

interface PitchSegment {
  start: number;
  detectedStart: number;
  end: number;
  values: number[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function gapBetween(left: NoteEvent, right: NoteEvent): number {
  return right.start - (left.start + left.dur);
}

function span(left: NoteEvent, right: NoteEvent, pitch: NoteEvent): NoteEvent {
  return { ...pitch, start: left.start, dur: right.start + right.dur - left.start };
}

/**
 * Onsets and short pitch glitches are common in live singing. Keep a short
 * leading/trailing fragment only when it is as long as its neighbour; otherwise
 * absorb it into the stable note. Adjacent equal-pitch segments are collapsed
 * here and expanded again against repeated targets during scoring, so a singer
 * does not have to leave a gap between two notes on the same pitch.
 */
function mergeTransientFragments(notes: readonly NoteEvent[]): NoteEvent[] {
  const adjacent: NoteEvent[] = [];
  for (const note of notes) {
    const previous = adjacent.at(-1);
    if (previous && gapBetween(previous, note) <= 60) {
      if (previous.midi === note.midi && Math.abs(previous.cents - note.cents) <= 50) {
        adjacent[adjacent.length - 1] = span(previous, note, previous.dur >= note.dur ? previous : note);
        continue;
      }
      const shorter = previous.dur < note.dur ? previous : note;
      const longer = previous.dur < note.dur ? note : previous;
      const pitchDistance = Math.abs(previous.midi + previous.cents / 100 - (note.midi + note.cents / 100));
      const leadingOnset = adjacent.length === 1 && shorter === previous && pitchDistance <= 1;
      if ((pitchDistance < 0.95 || leadingOnset) && (shorter.dur < 150 || (leadingOnset && shorter.dur <= 200)) &&
          longer.dur >= shorter.dur * 1.7) {
        adjacent[adjacent.length - 1] = span(previous, note, longer);
        continue;
      }
    }
    adjacent.push({ ...note });
  }
  const merged: NoteEvent[] = [];
  for (let index = 0; index < adjacent.length; index += 1) {
    const note = adjacent[index]!;
    const previous = merged.at(-1);
    const next = adjacent[index + 1];
    const notePitch = note.midi + note.cents / 100;
    const previousPitch = previous ? previous.midi + previous.cents / 100 : 0;
    const nextPitch = next ? next.midi + next.cents / 100 : 0;
    if (previous && next && note.dur < 150 && Math.abs(notePitch - previousPitch) < 0.95 &&
        Math.abs(notePitch - nextPitch) < 0.95 && gapBetween(previous, note) <= 60 && gapBetween(note, next) <= 60) {
      merged[merged.length - 1] = span(previous, next, previous.dur >= next.dur ? previous : next);
      index += 1;
      continue;
    }
    merged.push({ ...note });
  }
  return merged;
}

function attackStart(frames: readonly PitchFrame[], index: number): number {
  const detected = frames[index]!;
  const threshold = Math.max(0.008, detected.rms * 0.25);
  let start = detected.t;
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const frame = frames[previous]!;
    if (start - frame.t > 40 || frame.rms < threshold || pitchFromFrame(frame) !== null) break;
    if (detected.t - frame.t > 60) return detected.t;
    start = frame.t;
  }
  return start;
}

export function segmentPitchFrames(frames: readonly PitchFrame[], minimumDuration = 90): readonly NoteEvent[] {
  if (!Number.isFinite(minimumDuration) || minimumDuration <= 0) throw new RangeError('invalid minimum duration');
  const notes: NoteEvent[] = [];
  let active: PitchSegment | null = null;
  let candidate: PitchSegment | null = null;
  const finish = (): void => {
    if (active && active.end - active.detectedStart >= minimumDuration) {
      const pitch = median(active.values);
      const midi = Math.round(pitch);
      notes.push({ midi, cents: (pitch - midi) * 100, start: active.start, dur: active.end - active.start });
    }
    active = null;
  };
  frames.forEach((frame, index) => {
    if (![frame.t, frame.f0, frame.clarity, frame.rms].every(Number.isFinite) || frame.clarity < 0 || frame.clarity > 1 || frame.rms < 0 || (index > 0 && frame.t < frames[index - 1]!.t)) throw new RangeError('invalid pitch frame sequence');
    const next = frames[index + 1];
    const end = frame.t + Math.min(40, next ? Math.max(1, next.t - frame.t) : 20);
    const pitch = pitchFromFrame(frame);
    if (pitch === null) {
      candidate = null;
      if (active && frame.t - active.end > 60) finish();
      return;
    }
    if (active && frame.t - (candidate?.end ?? active.end) > 60) { finish(); candidate = null; }
    if (!active) { active = { start: attackStart(frames, index), detectedStart: frame.t, end, values: [pitch] }; return; }
    const center = median(active.values);
    if (frame.t - active.detectedStart < 80) {
      active.end = end;
      if (Math.abs(pitch - center) < 0.8) active.values.push(pitch);
      candidate = null;
      return;
    }
    if (Math.round(pitch) === Math.round(center) || Math.abs(pitch - center) < 0.8) {
      candidate = null; active.end = end; active.values.push(pitch); return;
    }
    if (!candidate || Math.abs(pitch - median(candidate.values)) >= 0.6) candidate = { start: frame.t, detectedStart: frame.t, end, values: [pitch] };
    else { candidate.end = end; candidate.values.push(pitch); }
    if (candidate.end - candidate.start >= 90) { finish(); active = candidate; candidate = null; }
  });
  finish();
  return mergeTransientFragments(notes);
}
