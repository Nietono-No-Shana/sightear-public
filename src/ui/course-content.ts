/// <reference path="./course-content.d.ts" />
import { summaries, loaders } from 'virtual:course-library';
import { cachedLoader, createLessonLoader } from '../store/course-loading';

const packs = import.meta.glob('../../content/packs/**/*.json', { import: 'default' });
export { summaries };
export const loadCourse = cachedLoader(async (id: string) => {
  const load = loaders[id];
  if (!load) throw new Error('未知课程');
  return load();
});
export const loadLesson = createLessonLoader(async (path) => {
  const load = packs[path];
  if (!load) throw new Error('找不到课程内容包');
  return load();
});
