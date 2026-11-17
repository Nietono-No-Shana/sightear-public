import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const wavePath = resolve('dist/vocal-test-input.wav');
const rate = 48000;
const sampleCount = rate * 12;
const wave = Buffer.alloc(44 + sampleCount * 2);
wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
wave.write('data', 36); wave.writeUInt32LE(sampleCount * 2, 40);
for (let index = 0; index < sampleCount; index += 1) wave.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 130.81278265 * index / rate)), 44 + index * 2);
await writeFile(wavePath, wave);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wavePath}`,
] });
try {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.argv[3] ?? 'http://127.0.0.1:4179');
  await page.locator('.js-settings').click();
  assert.equal(await page.locator('.js-vocal-low').isVisible(), false);
  await page.locator('.js-vocal-range').selectOption('tenor');
  assert.equal(await page.locator('.js-vocal-low').inputValue(), '48');
  assert.equal(await page.locator('.js-vocal-high').inputValue(), '64');
  await page.locator('.js-vocal-low').selectOption('65');
  assert.match(await page.locator('.js-vocal-status').textContent(), /尚未保存/);
  await page.locator('.js-vocal-low').selectOption('48');
  await page.locator('.js-vocal-high').selectOption('60');
  await page.reload();
  await page.locator('.js-settings').click();
  assert.equal(await page.locator('.js-vocal-range').inputValue(), 'tenor');
  assert.equal(await page.locator('.js-vocal-low').inputValue(), '48');
  assert.equal(await page.locator('.js-vocal-high').inputValue(), '60');
  await page.screenshot({ path: 'dist/comfortable-range-settings.png', fullPage: true });
  await page.locator('.js-pilot').click();
  await page.locator('.pilot-grid > button').filter({ hasText: '旋律视唱' }).click();
  assert.equal(await page.locator('.pilot-given svg').getAttribute('data-clef'), 'bass');
  assert.equal(await page.locator('[data-note-index="0"]').getAttribute('data-note-midi'), '48');
  await page.locator('.pilot-record').click();
  await page.locator('.pilot-live-pitch').filter({ hasText: 'C3' }).waitFor();
  const position = await page.locator('.pilot-given svg').evaluate((svg) => {
    const head = svg.querySelector('.pilot-pitch-layer circle');
    const note = svg.querySelector('[data-note-index="0"] ellipse');
    return { pitch: Number(head.getAttribute('cy')), note: Number(note.getAttribute('cy')), path: svg.querySelector('.pilot-pitch-path').getAttribute('d') };
  });
  assert.ok(Math.abs(position.pitch - position.note) < 1, JSON.stringify(position));
  assert.ok(position.path.length > 0);
  await page.screenshot({ path: 'dist/vocal-tenor.png', fullPage: true });
  await page.waitForFunction(() => document.querySelector('.pilot-record')?.textContent === '重新录入', undefined, { timeout: 10000 });
  assert.ok(await page.locator('.pilot-recording-audio').getAttribute('src'));
  await page.locator('.pilot-submit').click();
  await page.locator('.pilot-feedback h3').filter({ hasText: '得分' }).waitFor();
  assert.match(await page.locator('.pilot-score-breakdown').textContent(), /音准.*节奏/);
  assert.match(await page.locator('.pilot-details').textContent(), /音准分.*节奏分/);
  await page.screenshot({ path: 'dist/graded-performance-feedback.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: comfortable bounds validated and persisted; C3 trace overlays bass staff; replay and graded feedback available');
} finally {
  await browser.close();
  await unlink(wavePath);
}
