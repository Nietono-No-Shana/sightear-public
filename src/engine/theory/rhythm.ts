import type { Duration, TimeSignature, Tuplet } from '../ports';

const DOT_FACTORS: Readonly<Record<0 | 1 | 2, number>> = {
  0: 1,
  1: 1.5,
  2: 1.75,
};

const VALID_DURATION_VALUES: ReadonlySet<number> = new Set([1, 2, 4, 8, 16, 32]);
const COMPLETE_EPSILON = 1e-9;

function assertTuplet(tuplet: Tuplet): void {
  if (!Number.isInteger(tuplet.actual) || tuplet.actual < 2) {
    throw new RangeError(`tuplet actual must be an integer >= 2, got ${tuplet.actual}`);
  }
  if (!Number.isInteger(tuplet.normal) || tuplet.normal < 1) {
    throw new RangeError(`tuplet normal must be a positive integer, got ${tuplet.normal}`);
  }
  if (tuplet.actual === tuplet.normal) {
    throw new RangeError('tuplet actual and normal must differ');
  }
}

export function assertDuration(duration: Duration): void {
  if (!VALID_DURATION_VALUES.has(duration.value)) {
    throw new RangeError(`invalid duration value ${duration.value}`);
  }
  if (duration.dots !== 0 && duration.dots !== 1 && duration.dots !== 2) {
    throw new RangeError(`invalid dot count ${duration.dots}`);
  }
  if (duration.tuplet !== undefined) {
    assertTuplet(duration.tuplet);
  }
}

export function assertTimeSignature(time: TimeSignature): void {
  if (!Number.isInteger(time.beats) || time.beats < 1) {
    throw new RangeError(`time signature beats must be a positive integer, got ${time.beats}`);
  }
  if (time.unit !== 2 && time.unit !== 4 && time.unit !== 8) {
    throw new RangeError(`time signature unit must be 2, 4 or 8, got ${time.unit}`);
  }
}

export function durationInWholeNotes(duration: Duration): number {
  assertDuration(duration);
  const tuplet = duration.tuplet;
  const tupletFactor = tuplet === undefined ? 1 : tuplet.normal / tuplet.actual;
  return (1 / duration.value) * DOT_FACTORS[duration.dots] * tupletFactor;
}

export function measureLengthInWholeNotes(time: TimeSignature): number {
  assertTimeSignature(time);
  return time.beats / time.unit;
}

/** 精确 tick 数，可能不是整数；取整策略属于排程/记谱 adapter，不在 theory 里决定。 */
export function durationTicks(duration: Duration, ticksPerQuarter = 480): number {
  if (!Number.isInteger(ticksPerQuarter) || ticksPerQuarter <= 0) {
    throw new RangeError(`ticksPerQuarter must be a positive integer, got ${ticksPerQuarter}`);
  }
  return durationInWholeNotes(duration) * 4 * ticksPerQuarter;
}

export function isMeasureComplete(
  durations: readonly Duration[],
  time: TimeSignature,
): boolean {
  const total = durations.reduce((sum, duration) => sum + durationInWholeNotes(duration), 0);
  return Math.abs(total - measureLengthInWholeNotes(time)) < COMPLETE_EPSILON;
}
