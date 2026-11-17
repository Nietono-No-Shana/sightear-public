import { contentPilotCases, type PilotCase } from './pilot';
import type { Direction } from '../engine/ports';
import type { CourseGroup } from './course-localization';

export interface CourseSummary {
  id: string;
  title: string;
  subtitle: string;
  group: CourseGroup;
  total: number;
  moduleCount: number;
}
export interface LessonIndex {
  id: string; number: string; title: string; originalTitle: string; reason: string;
  content?: { path: string; exampleId: string; inversion: boolean; direction: Direction; questions: number; reference: 'none' | 'tonic' | 'chord' };
}
export interface CourseIndex extends CourseSummary {
  modules: { id: string; title: string; lessons: LessonIndex[] }[];
}

export function cachedLoader<Key, Value>(load: (key: Key) => Promise<Value>): (key: Key) => Promise<Value> {
  const cache = new Map<Key, Promise<Value>>();
  return (key) => {
    let pending = cache.get(key);
    if (!pending) {
      pending = Promise.resolve().then(() => load(key)).catch((error: unknown) => { cache.delete(key); throw error; });
      cache.set(key, pending);
    }
    return pending;
  };
}

export function createLessonLoader(loadPack: (path: string) => Promise<unknown>) {
  const packs = cachedLoader(async (path: string) => contentPilotCases(await loadPack(path)));
  return async (lesson: LessonIndex): Promise<PilotCase> => {
    if (!lesson.content) throw new Error('本课尚无题目内容');
    const examples = await packs(lesson.content.path);
    const example = examples.find((entry) => entry.id === lesson.content!.exampleId);
    if (!example) throw new Error('课程索引与内容版本不一致，请刷新页面');
    return example;
  };
}
