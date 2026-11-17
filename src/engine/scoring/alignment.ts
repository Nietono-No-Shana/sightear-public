export interface AlignmentPair {
  expected: number | null;
  actual: number | null;
}

export function alignSequences(expectedCount: number, actualCount: number, cost: (expected: number, actual: number) => number): readonly AlignmentPair[] {
  const costs = Array.from({ length: expectedCount + 1 }, () => Array<number>(actualCount + 1).fill(0));
  const steps = Array.from({ length: expectedCount + 1 }, () => Array<'match' | 'missing' | 'extra'>(actualCount + 1).fill('match'));
  for (let index = 1; index <= expectedCount; index += 1) { costs[index]![0] = index; steps[index]![0] = 'missing'; }
  for (let index = 1; index <= actualCount; index += 1) { costs[0]![index] = index; steps[0]![index] = 'extra'; }
  for (let expected = 1; expected <= expectedCount; expected += 1) {
    for (let actual = 1; actual <= actualCount; actual += 1) {
      const match = costs[expected - 1]![actual - 1]! + cost(expected - 1, actual - 1);
      const missing = costs[expected - 1]![actual]! + 1;
      const extra = costs[expected]![actual - 1]! + 1;
      costs[expected]![actual] = Math.min(match, missing, extra);
      steps[expected]![actual] = match <= missing && match <= extra ? 'match' : missing <= extra ? 'missing' : 'extra';
    }
  }
  const pairs: AlignmentPair[] = [];
  let expected = expectedCount;
  let actual = actualCount;
  while (expected > 0 || actual > 0) {
    const step = steps[expected]![actual]!;
    pairs.push({ expected: step === 'extra' ? null : --expected, actual: step === 'missing' ? null : --actual });
  }
  return pairs.reverse();
}
