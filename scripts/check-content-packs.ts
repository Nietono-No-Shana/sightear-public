import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { parseContentPack } from '../src/engine/config';
import { auditContentLesson } from '../src/engine/items';
import { createRngFactory } from '../src/adapters/rng';
import { jsonFiles } from './content-files';

const root = resolve('content/packs');
const argumentsList = process.argv.slice(2);
if (argumentsList.length > 1) throw new RangeError('usage: content:check [content/packs/file.json]');
const requested = argumentsList[0] ? resolve(argumentsList[0]) : undefined;
const allFiles = await jsonFiles(root);
if (requested && !allFiles.includes(requested)) throw new RangeError('requested file is not a JSON content pack under content/packs');
const files = requested ? [requested] : allFiles;
if (files.length === 0) throw new Error('No content pack JSON files found in content/packs');
const packRevisions = new Set<string>();
const lessonIds = new Set<string>();
const sourceAddresses = new Set<string>();
const failures: string[] = [];
for (const file of files.sort()) {
  try {
    const pack = parseContentPack(JSON.parse(await readFile(file, 'utf8')) as unknown);
    const revisionKey = `${pack.packId}@${pack.revision}`;
    if (packRevisions.has(revisionKey)) throw new RangeError(`duplicate pack revision ${revisionKey}`);
    packRevisions.add(revisionKey);
    for (const lesson of pack.lessons) {
      const lessonKey = `${pack.packId}:${lesson.id}`;
      if (lessonIds.has(lessonKey)) throw new RangeError(`duplicate lesson id ${lessonKey}`);
      lessonIds.add(lessonKey);
      if (lesson.source.address) {
        const address = lesson.source.address;
        const sourceKey = `${address.courseId}:a${address.activity}:m${address.module}:l${address.lesson}`;
        if (sourceAddresses.has(sourceKey)) throw new RangeError(`duplicate source lesson across packs: ${sourceKey}`);
        sourceAddresses.add(sourceKey);
      }
      const audit = auditContentLesson(lesson, createRngFactory());
      console.log(`  SAMPLE ${lesson.id}: ${audit.samples} deterministic items, ${audit.distinct} distinct material/answers`);
    }
    console.log(`PASS ${relative(process.cwd(), file)}: ${pack.lessons.length} lesson(s), ${revisionKey}`);
  } catch (error) {
    failures.push(`${relative(process.cwd(), file)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} pack(s), ${lessonIds.size} lesson(s). Validation does not publish content.`);
}
