import type { Duration } from '../engine/ports';

export interface ScorePosition {
  x: number;
  y: number;
  duration: Duration;
  tie: boolean;
  measure: number;
}

export function scoreLinks(positions: readonly ScorePosition[]) {
  const ties: { from: ScorePosition; to: ScorePosition }[] = [];
  const tuplets: { from: ScorePosition; to: ScorePosition; count: number }[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    const from = positions[index]!;
    if (from.tie && positions[index + 1]) ties.push({ from, to: positions[index + 1]! });
  }
  for (let index = 0; index < positions.length; index += 1) {
    const from = positions[index]!;
    const tuplet = from.duration.tuplet;
    if (!tuplet) continue;
    const group = positions.slice(index, index + tuplet.actual);
    if (group.length !== tuplet.actual || group.some((note) => note.measure !== from.measure || note.duration.value !== from.duration.value ||
      note.duration.tuplet?.actual !== tuplet.actual || note.duration.tuplet?.normal !== tuplet.normal)) continue;
    tuplets.push({ from, to: group.at(-1)!, count: tuplet.actual });
    index += tuplet.actual - 1;
  }
  return { ties, tuplets };
}
