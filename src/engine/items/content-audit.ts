import type { RngFactory } from '../ports';
import { lessonForContent, skillsForPracticeSpec, type ContentLesson } from '../config';
import { scoreTimeline } from '../theory';
import { generate } from './generate';
import { generateExercise } from './exercise';

export function auditContentLesson(entry: ContentLesson, factory: RngFactory, sampleCount = 32): { samples: number; distinct: number } {
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 1024) throw new RangeError('audit sample count must be 1..1024');
  lessonForContent(entry);
  const spec = entry.spec;
  const variants = new Set<string>();
  let samples = 0;
  const skills = 'kind' in spec ? [null] : skillsForPracticeSpec(spec);
  for (const skill of skills) for (let index = 0; index < sampleCount; index += 1) {
    const seed = index * 9973;
    const create = () => 'kind' in spec ? generateExercise(spec, seed, factory)
      : generate(skill!, { register: 'mid', direction: spec.stimulus.direction, reference: 'none',
        timbre: 'piano', tempoBpm: spec.stimulus.tempoBpm, voices: 1, bars: 1, chunk: 1 }, seed, factory, undefined, spec);
    try {
      const item = create();
      if (JSON.stringify(create()) !== JSON.stringify(item)) throw new RangeError('non-deterministic item');
      if (item.answerScore) scoreTimeline(item.answerScore, 'kind' in spec ? spec.tempoBpm : spec.stimulus.tempoBpm);
      variants.add(JSON.stringify([item.answerScore, item.presented.stimulus, item.key]));
      samples += 1;
    } catch (error) {
      throw new RangeError(`${entry.id}, seed=${seed}, skill=${skill ?? 'exercise'}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { samples, distinct: variants.size };
}
