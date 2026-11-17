import type { ItemFeatures, Pitch, Rng, SoundEvent } from '../ports';
import type { ChoicePracticeSpec, ComparisonSkillMeta } from '../config';
import { toPitch, transposeBy, type SpelledPitch } from '../theory';

export function comparisonContent(
  root: SpelledPitch,
  meta: ComparisonSkillMeta,
  features: ItemFeatures,
  rng: Rng,
  spec: ChoicePracticeSpec | undefined,
): { content: readonly SoundEvent[]; answerPitches: readonly Pitch[] } {
  if (spec?.task.kind !== 'interval-comparison') throw new RangeError('comparison requires a practice spec');
  const spans = [...spec.task.semitones].sort((first, second) => first - second);
  const pairs: readonly (readonly [number, number])[] = meta.code === 'equal'
    ? spans.map((span) => [span, span])
    : spans.flatMap((smaller, index) => spans.slice(index + 1).map((larger): readonly [number, number] => [smaller, larger]));
  const selected = pairs[rng.int(pairs.length)];
  if (!selected) throw new RangeError('comparison has no material');
  const ordered = meta.code === 'a-larger' ? [selected[1], selected[0]] : selected;
  const targets = ordered.map((span) => {
    const degree = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7][span % 12]! + Math.floor(span / 12) * 7;
    return transposeBy(root, degree, span);
  });
  const beat = 60_000 / features.tempoBpm;
  const duration = Math.round(beat * 0.9);
  const secondStart = Math.round(beat) + duration + Math.round(spec.stimulus.gapBeats * beat);
  const pitches = [root, targets[0]!, root, targets[1]!];
  const starts = [0, Math.round(beat), secondStart, secondStart + Math.round(beat)];
  return {
    content: pitches.map((pitch, index) => ({
      kind: 'note', midi: pitch.midi, velocity: 0.8, start: starts[index]!, dur: duration, timbre: features.timbre,
    })),
    answerPitches: pitches.map(toPitch),
  };
}
