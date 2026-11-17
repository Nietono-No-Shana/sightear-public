import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { parseContentReview } from '../src/engine/config';
import { buildCatalogLibrary, buildCourseLibrary, parseCourseCatalog, type CourseInventory, type LibraryCourse } from '../src/store/course-library';
import { courseMeta, isCourseHidden, lessonTitle, moduleTitle } from '../src/store/course-localization';
import type { CourseIndex } from '../src/store/course-loading';
import { jsonFiles, readContentPacks } from './content-files';

export function presentCourseLibrary(courses: readonly LibraryCourse[], paths: ReadonlyMap<string, string>): CourseIndex[] {
  return courses
    .filter((course) => !isCourseHidden(course.id))
    .map((course) => {
      const meta = course.presentation ?? courseMeta(course.id, course.title);
      const modules = course.modules
        .map((module) => ({ ...module, lessons: module.lessons.filter((lesson) => lesson.example !== undefined) }))
        .filter((module) => module.lessons.length > 0)
        .map((module, moduleIndex) => ({
          id: module.id,
          title: moduleTitle(module.id, module.title),
          lessons: module.lessons.map((lesson, index): CourseIndex['modules'][number]['lessons'][number] => {
            const example = lesson.example!;
            const spec = example.lesson.practiceSpec;
            const moduleNumber = String(moduleIndex + 1);
            return {
              id: lesson.id,
              number: `${moduleNumber}.${index + 1}`,
              title: lessonTitle(lesson.id, lesson.title, index, example.title),
              originalTitle: lesson.title,
              reason: '',
              content: {
                path: paths.get(example.id)!,
                exampleId: example.id,
                inversion: spec?.task.kind === 'chord-inversion',
                direction: spec?.stimulus.direction ?? 'harmonic',
                questions: spec?.questionCount ?? example.lesson.exerciseSpec?.questionCount ?? 1,
                reference: spec?.stimulus.reference ?? 'none',
              },
            };
          }),
        }));
      const total = modules.reduce((sum, module) => sum + module.lessons.length, 0);
      return {
        id: course.id,
        title: meta.title,
        subtitle: meta.subtitle,
        group: meta.group,
        total,
        moduleCount: modules.length,
        modules,
      };
    })
    .filter((course) => course.modules.length > 0);
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function buildLibraryIndex(): Promise<CourseIndex[]> {
  const packs = await readContentPacks();
  const paths = new Map<string, string>(packs.flatMap(({ file, pack }) => pack.lessons.map((lesson) =>
    [`content:${pack.packId}@${pack.revision}:${lesson.id}`, `../../${relative(process.cwd(), file).replaceAll('\\', '/')}`] as const)));
  const catalog = await readOptionalJson('content/catalog.json');
  if (catalog !== undefined) {
    return presentCourseLibrary(buildCatalogLibrary(parseCourseCatalog(catalog), packs.map(({ pack }) => pack)).courses, paths);
  }
  const inventory = (await readOptionalJson('docs/catalog-content-inventory.json')) as CourseInventory | undefined;
  if (inventory === undefined) {
    throw new Error('content/catalog.json is required when docs/catalog-content-inventory.json is absent');
  }
  const reviews = await Promise.all((await jsonFiles('content/reviews')).map(async (file) => parseContentReview(JSON.parse(await readFile(file, 'utf8')))));
  return presentCourseLibrary(buildCourseLibrary(inventory, reviews, packs.map(({ pack }) => pack)), paths);
}

export function courseLibraryPlugin(): Plugin {
  const prefix = 'virtual:course-library';
  let index: Promise<CourseIndex[]> | undefined;
  const invalidate = (): void => { index = undefined; };
  return {
    name: 'course-library-index',
    buildStart: invalidate,
    resolveId(id) { if (id === prefix || id.startsWith(`${prefix}/`)) return `\0${id}`; },
    async load(id) {
      if (!id.startsWith(`\0${prefix}`)) return;
      index ??= buildLibraryIndex().catch((error: unknown) => { invalidate(); throw error; });
      const courses = await index;
      if (id === `\0${prefix}`) {
        const summaries = courses.map(({ modules: _modules, ...summary }) => summary);
        const loaders = courses.map((course, position) => `${JSON.stringify(course.id)}:()=>import(${JSON.stringify(`${prefix}/${position}`)}).then(module=>module.default)`);
        return `export const summaries=${JSON.stringify(summaries)};export const loaders={${loaders.join(',')}};`;
      }
      const course = courses[Number(id.slice(`\0${prefix}/`.length))];
      if (!course) throw new Error('Unknown course index');
      return `export default ${JSON.stringify(course)};`;
    },
    configureServer(server) {
      const changed = (file: string): void => {
        const path = relative(process.cwd(), resolve(file)).replaceAll('\\', '/');
        if (!path.startsWith('content/') && path !== 'docs/catalog-content-inventory.json') return;
        invalidate();
        for (const module of server.moduleGraph.idToModuleMap.values()) {
          if (module.id?.startsWith(`\0${prefix}`)) server.moduleGraph.invalidateModule(module);
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', changed).on('change', changed).on('unlink', changed);
      server.httpServer?.once('close', () => { server.watcher.off('add', changed).off('change', changed).off('unlink', changed); });
      server.httpServer?.once('listening', () => {
        const timer = setTimeout(() => {
          if (index !== undefined) return;
          index = buildLibraryIndex().catch((error: unknown) => { invalidate(); throw error; });
          void index.catch(() => {});
        }, 500);
        timer.unref?.();
      });
    },
  };
}
