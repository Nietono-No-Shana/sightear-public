import type { Rng, RngFactory } from '../../src/engine/ports';

function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };

  return {
    next,
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
      }
      return Math.floor(next() * maxExclusive);
    },
    fork(label: string): Rng {
      return makeRng((state ^ hashLabel(label)) >>> 0);
    },
  };
}

export function makeRngFactory(): RngFactory {
  return { fromSeed: (seed: number) => makeRng(seed) };
}
