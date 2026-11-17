export function deviationCredit(error: number, tolerance: number, kind: 'pitch' | 'timing', grading: 'graded-v1' | 'graded-v2' = 'graded-v1'): number {
  const magnitude = Math.abs(error);
  if (magnitude <= tolerance + 1e-7) return 1;
  const limits = kind === 'pitch'
    ? (grading === 'graded-v2' ? [tolerance, tolerance + 15, tolerance + 35, tolerance + 50, tolerance + 75]
      : [tolerance, tolerance + 25, tolerance + 50, tolerance + 100, tolerance + 150])
    : (grading === 'graded-v2' ? [tolerance, tolerance * 1.5, tolerance * 2, tolerance * 2.5, tolerance * 3]
      : [tolerance, tolerance * 1.5, tolerance * 2, tolerance * 3, tolerance * 4]);
  const credits = [1, 0.8, 0.5, 0.2, 0];
  const next = limits.findIndex((limit) => limit >= magnitude);
  if (next < 1) return 0;
  const fraction = (magnitude - limits[next - 1]!) / (limits[next]! - limits[next - 1]!);
  return credits[next - 1]! + (credits[next]! - credits[next - 1]!) * fraction;
}
