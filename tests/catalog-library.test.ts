import { readFile } from 'node:fs/promises';
import { parseContentPack } from '../src/engine/config';
import { buildCatalogLibrary, parseCourseCatalog } from '../src/store/course-library';

async function samplePack() {
  return parseContentPack(JSON.parse(await readFile('content/packs/authoring-v3-sample.json', 'utf8')));
}

function catalog(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    courses: [{
      id: 'sightear:sample', title: '样例课程', subtitle: '三课', group: 'comprehensive',
      modules: [{
        id: 'sightear:sample:basic', title: '基础',
        lessons: [
          { id: 'sightear:sample:basic:1', title: '音程', content: { packId: 'sample.authoring-v3', lessonId: 'sample.interval' } },
          { id: 'sightear:sample:basic:2', title: '待编写', reason: '尚未编写' },
        ],
      }],
      ...overrides,
    }],
  };
}

it('builds a library from the content catalog and attaches pack examples', async () => {
  const result = buildCatalogLibrary(parseCourseCatalog(catalog()), [await samplePack()]);
  expect(result.lessons).toBe(2);
  expect(result.authored).toBe(1);
  const course = result.courses[0]!;
  expect(course.presentation).toEqual({ title: '样例课程', subtitle: '三课', group: 'comprehensive' });
  const [authored, pending] = course.modules[0]!.lessons;
  expect(authored!.example?.lesson.practiceSpec?.title).toBe('下行三度辨认');
  expect(pending!.example).toBeUndefined();
  expect(pending!.reason).toBe('尚未编写');
});

it('fails the build on unknown packs, unknown lessons, and duplicate ids', async () => {
  const pack = await samplePack();
  const unknownPack = catalog();
  unknownPack.courses[0]!.modules[0]!.lessons[0]!.content!.packId = 'sample.missing';
  expect(() => buildCatalogLibrary(parseCourseCatalog(unknownPack), [pack])).toThrow('unknown pack');

  const unknownLesson = catalog();
  unknownLesson.courses[0]!.modules[0]!.lessons[0]!.content!.lessonId = 'sample.missing';
  expect(() => buildCatalogLibrary(parseCourseCatalog(unknownLesson), [pack])).toThrow('unknown lesson');

  const duplicate = catalog();
  duplicate.courses[0]!.modules[0]!.lessons[1]!.id = 'sightear:sample:basic:1';
  expect(() => parseCourseCatalog(duplicate)).toThrow('duplicate id');
});

it('rejects unsupported catalog shapes', () => {
  expect(() => parseCourseCatalog({ ...catalog(), schemaVersion: 2 })).toThrow('schemaVersion');
  expect(() => parseCourseCatalog({ ...catalog(), courses: [] })).toThrow('1..100');
  expect(() => parseCourseCatalog(catalog({ group: 'unknown' }))).toThrow('unknown group');
  expect(() => parseCourseCatalog(catalog({ extra: true }))).toThrow('unsupported field');
});
