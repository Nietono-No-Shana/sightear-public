import { auditContentCoverage, practiceSpecForLesson, validatePracticeSpec, type ContentPack, type ContentReview } from '../engine/config';
import type { Direction } from '../engine/ports';
import { COURSE_GROUP_ORDER, type CourseGroup } from './course-localization';
import { contentPilotCases, type PilotCase } from './pilot';

export interface CourseInventory {
  archives: readonly { course?: { id: string; title: string; modules: readonly {
    address: string; activity: number; activityTitle: string; displayTitle: string;
    lessons: readonly { address: string; displayTitle: string }[];
  }[] } }[];
}

/** Content-side catalog: the course tree ships with the content, not with the code. */
export interface CatalogLesson {
  readonly id: string;
  readonly title: string;
  readonly reason?: string;
  readonly content?: { readonly packId: string; readonly lessonId: string };
}
export interface CatalogModule { readonly id: string; readonly title: string; readonly lessons: readonly CatalogLesson[] }
export interface CatalogCourse {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly group?: CourseGroup;
  readonly modules: readonly CatalogModule[];
}
export interface CourseCatalog { readonly schemaVersion: 1; readonly courses: readonly CatalogCourse[] }

export interface LibraryLesson { id: string; title: string; reason: string; example?: PilotCase }
export interface LibraryModule { id: string; title: string; lessons: LibraryLesson[] }
export interface LibraryCourse {
  id: string;
  title: string;
  modules: LibraryModule[];
  /** Set by the catalog path so displayed titles come from the content file. */
  presentation?: { title: string; subtitle: string; group: CourseGroup };
}

export function inversionPlaybackCase(example: PilotCase, direction: Direction): PilotCase {
  const original = practiceSpecForLesson(example.lesson);
  if (original?.task.kind !== 'chord-inversion') throw new RangeError('expected inversion lesson');
  if (original.stimulus.direction === direction) return example;
  const id = `${example.id}:playback-v1:${direction}`;
  const title = `${example.title} · ${direction === 'asc' ? '上行琶音' : direction === 'desc' ? '下行琶音' : '同时发声'}`;
  const spec = { ...original, id, title, stimulus: { ...original.stimulus, direction } };
  validatePracticeSpec(spec);
  const { practiceSpecId: _practiceSpecId, ...lesson } = example.lesson;
  return { ...example, id, title, lesson: { ...lesson, id, title, directions: [direction], practiceSpec: spec } };
}

export function buildCourseLibrary(inventory: CourseInventory, reviews: readonly ContentReview[], packs: readonly ContentPack[]): LibraryCourse[] {
  const catalog = inventory.archives.flatMap(({ course }) => course?.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({ address: lesson.address, title: lesson.displayTitle, moduleTitle: module.displayTitle }))) ?? []);
  const audit = auditContentCoverage(catalog, reviews, packs);
  const decisions = new Map(audit.rows.map((row) => [row.address, row]));
  const examples = new Map<string, PilotCase>();
  for (const pack of packs) {
    const cases = contentPilotCases(pack);
    for (const lesson of pack.lessons) {
      const example = cases.find((entry) => entry.id === `content:${pack.packId}@${pack.revision}:${lesson.id}`)!;
      examples.set(`${pack.packId}:${lesson.id}`, example);
    }
  }
  const result = new Map<string, LibraryCourse>();
  for (const { course } of inventory.archives) {
    if (!course) continue;
    for (const module of course.modules) {
      const split = course.id === 'catalog:Std';
      const id = split ? `${course.id}:a${module.activity}` : course.id;
      const group = result.get(id) ?? { id, title: split ? module.activityTitle : course.title, modules: [] };
      group.modules.push({ id: module.address, title: module.displayTitle, lessons: module.lessons.map((lesson) => {
        const decision = decisions.get(lesson.address)!;
        const example = decision.decision === 'authored' ? examples.get(`${decision.packId}:${decision.lessonId}`) : undefined;
        return { id: lesson.address, title: lesson.displayTitle, reason: 'reason' in decision ? decision.reason : '尚未编写', ...(example ? { example } : {}) };
      }) });
      result.set(id, group);
    }
  }
  return [...result.values()];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) throw new RangeError(`${path}: unsupported field ${unexpected}`);
}

function assertId(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new RangeError(`${path}: invalid id`);
}

/** Parses content/catalog.json. Every id is global, so a broken ref fails the build. */
export function parseCourseCatalog(value: unknown): CourseCatalog {
  if (!record(value) || value.schemaVersion !== 1) throw new RangeError('catalog: expected schemaVersion 1');
  assertKeys(value, ['schemaVersion', 'courses'], 'catalog');
  if (!Array.isArray(value.courses) || value.courses.length < 1 || value.courses.length > 100) {
    throw new RangeError('catalog.courses: expected 1..100 courses');
  }
  const seen = new Set<string>();
  const courses = value.courses.map((course, index): CatalogCourse => {
    const path = `courses[${index}]`;
    if (!record(course)) throw new RangeError(`${path}: expected object`);
    assertKeys(course, ['id', 'title', 'subtitle', 'group', 'modules'], path);
    assertId(course.id, `${path}.id`);
    if (seen.has(course.id)) throw new RangeError(`${path}.id: duplicate id ${course.id}`);
    seen.add(course.id);
    if (typeof course.title !== 'string' || !course.title.trim()) throw new RangeError(`${path}.title: expected text`);
    if (course.subtitle !== undefined && (typeof course.subtitle !== 'string' || !course.subtitle.trim())) {
      throw new RangeError(`${path}.subtitle: expected text`);
    }
    if (course.group !== undefined && !COURSE_GROUP_ORDER.includes(course.group as CourseGroup)) {
      throw new RangeError(`${path}.group: unknown group`);
    }
    if (!Array.isArray(course.modules) || course.modules.length < 1 || course.modules.length > 100) {
      throw new RangeError(`${path}.modules: expected 1..100 modules`);
    }
    const modules = course.modules.map((module, moduleIndex): CatalogModule => {
      const modulePath = `${path}.modules[${moduleIndex}]`;
      if (!record(module)) throw new RangeError(`${modulePath}: expected object`);
      assertKeys(module, ['id', 'title', 'lessons'], modulePath);
      assertId(module.id, `${modulePath}.id`);
      if (seen.has(module.id)) throw new RangeError(`${modulePath}.id: duplicate id ${module.id}`);
      seen.add(module.id);
      if (typeof module.title !== 'string' || !module.title.trim()) throw new RangeError(`${modulePath}.title: expected text`);
      if (!Array.isArray(module.lessons) || module.lessons.length < 1 || module.lessons.length > 200) {
        throw new RangeError(`${modulePath}.lessons: expected 1..200 lessons`);
      }
      const lessons = module.lessons.map((lesson, lessonIndex): CatalogLesson => {
        const lessonPath = `${modulePath}.lessons[${lessonIndex}]`;
        if (!record(lesson)) throw new RangeError(`${lessonPath}: expected object`);
        assertKeys(lesson, ['id', 'title', 'reason', 'content'], lessonPath);
        assertId(lesson.id, `${lessonPath}.id`);
        if (seen.has(lesson.id)) throw new RangeError(`${lessonPath}.id: duplicate id ${lesson.id}`);
        seen.add(lesson.id);
        if (typeof lesson.title !== 'string' || !lesson.title.trim()) throw new RangeError(`${lessonPath}.title: expected text`);
        if (lesson.reason !== undefined && (typeof lesson.reason !== 'string' || !lesson.reason.trim())) {
          throw new RangeError(`${lessonPath}.reason: expected text`);
        }
        if (lesson.content !== undefined) {
          if (!record(lesson.content)) throw new RangeError(`${lessonPath}.content: expected object`);
          assertKeys(lesson.content, ['packId', 'lessonId'], `${lessonPath}.content`);
          assertId(lesson.content.packId, `${lessonPath}.content.packId`);
          assertId(lesson.content.lessonId, `${lessonPath}.content.lessonId`);
        }
        return lesson as unknown as CatalogLesson;
      });
      return { id: module.id, title: module.title, lessons };
    });
    return { ...(course as unknown as CatalogCourse), modules };
  });
  return { schemaVersion: 1, courses };
}

export interface CatalogResult { readonly courses: readonly LibraryCourse[]; readonly lessons: number; readonly authored: number }

/** Builds the library from a content catalog. Missing packs or lessons throw at build time. */
export function buildCatalogLibrary(catalog: CourseCatalog, packs: readonly ContentPack[]): CatalogResult {
  const examples = new Map<string, PilotCase>();
  for (const pack of packs) {
    for (const example of contentPilotCases(pack)) examples.set(example.id, example);
  }
  let lessons = 0;
  let authored = 0;
  const courses = catalog.courses.map((course): LibraryCourse => ({
    id: course.id,
    title: course.title,
    presentation: { title: course.title, subtitle: course.subtitle ?? '', group: course.group ?? 'comprehensive' },
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      lessons: module.lessons.map((lesson) => {
        lessons += 1;
        if (!lesson.content) {
          return { id: lesson.id, title: lesson.title, reason: lesson.reason ?? '尚未编写' };
        }
        const pack = packs.find((candidate) => candidate.packId === lesson.content!.packId);
        if (!pack) throw new RangeError(`catalog: unknown pack ${lesson.content.packId} for ${lesson.id}`);
        const example = examples.get(`content:${pack.packId}@${pack.revision}:${lesson.content.lessonId}`);
        if (!example) throw new RangeError(`catalog: unknown lesson ${lesson.content.lessonId} in pack ${pack.packId} for ${lesson.id}`);
        authored += 1;
        return { id: lesson.id, title: lesson.title, reason: lesson.reason ?? '', example };
      }),
    })),
  }));
  return { courses, lessons, authored };
}
