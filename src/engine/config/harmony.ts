import type { HarmonyStep } from '../ports';
import { scaleDegree, voiceChord, type ScaleMode, type SpelledPitch } from '../theory';
import { getSkill } from './skills';

export function resolveHarmonyStep(tonic: SpelledPitch, mode: ScaleMode, step: HarmonyStep) {
  if (!step || Object.keys(step).some((key) => !['degree', 'code', 'voicing'].includes(key)) ||
      !Number.isInteger(step.degree) || step.degree < 1 || step.degree > 7 || typeof step.code !== 'string') throw new RangeError('invalid harmony step');
  const skill = getSkill(`chord.identify.${step.code}`);
  if (skill.kind !== 'chord') throw new RangeError('unsupported harmony chord');
  const root = scaleDegree(tonic, mode, step.degree);
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][step.degree - 1]!;
  const tones = voiceChord(root, skill.quality, step.voicing);
  return { tones, symbol: `${roman}:${step.code}${step.voicing && step.voicing.bassDegree !== 1 ? `/bass${step.voicing.bassDegree}` : ''}` };
}
