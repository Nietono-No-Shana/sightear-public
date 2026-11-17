import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseContentPack } from '../src/engine/config';

export async function jsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return jsonFiles(path);
    return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
  }));
  return nested.flat().sort();
}

export async function readContentPacks() {
  const files = await jsonFiles('content/packs');
  return Promise.all(files.map(async (file) => ({ file, pack: parseContentPack(JSON.parse(await readFile(file, 'utf8'))) })));
}
