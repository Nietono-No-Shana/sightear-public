import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${process.argv[3] ?? 'http://127.0.0.1:5173'}/#pilot`);
  await page.getByRole('button', { name: '简易音符编辑器', exact: true }).click();
  await page.locator('.pilot-editor').focus();
  await page.keyboard.press('a');
  await page.keyboard.press('8');
  await page.keyboard.press('Enter');
  await page.keyboard.press(']');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.locator('[data-note-name]').evaluateAll((notes) => notes.map((note) => note.getAttribute('data-note-name'))), ['A4', 'A#4']);
  assert.deepEqual(await page.locator('[data-note-duration]').evaluateAll((notes) => notes.map((note) => Number(note.getAttribute('data-note-duration')))), [0.5, 0.5]);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('[data-note-index]').count(), 1);
  const score = page.locator('.pilot-score svg');
  const bounds = await score.boundingBox();
  if (!bounds) throw new Error('score surface is not visible');
  await page.mouse.click(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.5);
  assert.equal(await page.locator('[data-note-index]').count(), 2);
  assert.deepEqual(errors, []);
  console.log('PASS: keyboard pitch/duration/accidental input, undo, staff-click insertion');
} finally {
  await browser.close();
}
