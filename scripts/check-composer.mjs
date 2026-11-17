import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const wavePath = resolve('dist/composer-input.wav');
const rate = 48000;
const count = rate * 50;
const wave = Buffer.alloc(44 + count * 2);
wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
wave.write('data', 36); wave.writeUInt32LE(count * 2, 40);
for (let index = 0; index < count; index += 1) wave.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 261.625565 * index / rate)), 44 + index * 2);
await writeFile(wavePath, wave);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wavePath}`,
] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${process.argv[3] ?? 'http://127.0.0.1:4179'}/#pilot`);
  await page.getByRole('button', { name: '简易音符编辑器', exact: true }).click();
  assert.equal(await page.locator('.composer-practice').isDisabled(), true);
  await page.locator('.pilot-pitch-input .pilot-pitch-letter').selectOption('C');
  await page.locator('.pilot-pitch-input .pilot-pitch-octave').selectOption('2');
  await page.locator('.pilot-add').click();
  const lowVisible = await page.locator('.pilot-score svg').evaluate((svg) => {
    const view = svg.getAttribute('viewBox').split(' ').map(Number);
    const noteY = Number(svg.querySelector('ellipse').getAttribute('cy'));
    return noteY >= view[1] && noteY <= view[1] + view[3];
  });
  assert.equal(lowVisible, true);
  await page.locator('.pilot-undo').click();
  await page.locator('.pilot-pitch-input .pilot-pitch-letter').selectOption('C');
  await page.locator('.pilot-pitch-input .pilot-pitch-octave').selectOption('4');
  await page.locator('.pilot-pitch-input .pilot-pitch-accidental').selectOption('0');
  await page.locator('.pilot-duration').selectOption('16');
  for (let index = 0; index < 16; index += 1) await page.locator('.pilot-add').click();
  assert.equal(await page.locator('.pilot-duration').inputValue(), '16');
  assert.equal(await page.locator('.composer-practice').isEnabled(), true);
  await page.locator('.pilot-note-row').last().locator('input').last().check();
  assert.equal(await page.locator('.composer-practice').isDisabled(), true);
  await page.locator('.pilot-undo').click();
  for (let index = 0; index < 7; index += 1) await page.locator('.pilot-copy-measure').click();
  assert.equal(await page.locator('.pilot-copy-measure').isDisabled(), true);
  assert.equal(await page.locator('[data-note-index]').count(), 128);
  const layout = await page.locator('.pilot-score').evaluate((surface) => ({
    width: surface.clientWidth, scroll: surface.scrollWidth,
    noteWidth: surface.querySelector('ellipse').getBoundingClientRect().width,
    pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
  }));
  assert.ok(layout.scroll > layout.width * 4, JSON.stringify(layout));
  assert.ok(layout.noteWidth >= 15, JSON.stringify(layout));
  assert.ok(layout.pageWidth <= layout.viewport, JSON.stringify(layout));
  await page.locator('.composer-tempo').fill('60');
  await page.locator('.composer-play').click();
  await page.locator('.composer-status').filter({ hasText: '正在试听' }).waitFor();
  await page.locator('.composer-stop').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.composer-export').click();
  const download = await downloadPromise;
  await download.saveAs('dist/composer-roundtrip.json');
  await page.locator('.pilot-remove-measure').click();
  assert.equal(await page.locator('[data-note-index]').count(), 112);
  await page.locator('.composer-import').setInputFiles('dist/composer-roundtrip.json');
  await page.locator('.composer-status').filter({ hasText: '乐谱已导入' }).waitFor();
  assert.equal(await page.locator('[data-note-index]').count(), 128);
  await page.locator('.composer-import').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.locator('.composer-status').filter({ hasText: '当前草稿已保留' }).waitFor();
  assert.equal(await page.locator('[data-note-index]').count(), 128);
  await page.locator('.pilot-measure').selectOption('1');
  await page.locator('.pilot-measure').selectOption('0');
  assert.equal(await page.locator('.pilot-score').evaluate((surface) => surface.scrollLeft), 0);
  await page.screenshot({ path: 'dist/composer-long-score.png', fullPage: true });
  await page.locator('.composer-practice').click();
  assert.equal(await page.locator('.pilot-progress').textContent(), '1 / 1');
  await page.locator('.pilot-record').click();
  await page.waitForFunction(() => document.querySelector('.pilot-stop')?.disabled === false);
  await page.waitForFunction(() => document.querySelector('.pilot-given')?.scrollLeft > 500, undefined, { timeout: 10000 });
  await page.screenshot({ path: 'dist/composer-follow.png', fullPage: true });
  await page.waitForFunction(() => document.querySelector('.pilot-record')?.textContent === '重新录入', undefined, { timeout: 45000 });
  const recording = await page.locator('.pilot-recording-audio').evaluate(async (audio) => {
    const buffer = await (await fetch(audio.src)).arrayBuffer();
    const context = new OfflineAudioContext(1, 1, 48000);
    const decoded = await context.decodeAudioData(buffer);
    const samples = decoded.getChannelData(0);
    let peak = 0;
    for (let index = 31 * decoded.sampleRate; index < 32 * decoded.sampleRate; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
    return { duration: decoded.duration, peak };
  });
  assert.ok(recording.duration > 32 && recording.duration < 33, JSON.stringify(recording));
  assert.ok(recording.peak > 0.1, JSON.stringify(recording));
  await page.locator('.pilot-submit').click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '重复这组题', exact: true }).click();
  assert.equal(await page.locator('[data-note-index]').count(), 128);
  await page.locator('.pilot-back').click();
  await page.getByRole('button', { name: '简易音符编辑器', exact: true }).click();
  assert.equal(await page.locator('[data-note-index]').count(), 128);
  assert.deepEqual(errors, []);
  console.log('PASS: 128 readable notes, bounded horizontal scroll, edit/undo/ties, export/import, custom practice and repeat, auto-follow, real PCM beyond 30 seconds');
} finally {
  await browser.close();
  await unlink(wavePath);
}
