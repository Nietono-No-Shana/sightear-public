import type { Clock, Millis } from '../engine/ports';

const DAY_START_HOUR = 4;

export function createClock(): Clock {
  return {
    now: () => Date.now(),
    dayStart(now: Millis): Millis {
      const date = new Date(now);
      const start = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        DAY_START_HOUR,
        0,
        0,
        0,
      );
      if (start.getTime() > now) {
        start.setDate(start.getDate() - 1);
      }
      return start.getTime();
    },
  };
}
