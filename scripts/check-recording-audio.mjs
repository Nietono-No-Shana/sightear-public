import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const browser = await chromium.launch({ channel: process.argv[4] ?? 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.audioRecordings = [];
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        const destination = this.createMediaStreamDestination();
        const recorder = new MediaRecorder(destination.stream);
        const entry = { recorder, chunks: [], states: [], started: performance.now() };
        window.audioRecordings.push(entry);
        recorder.ondataavailable = (event) => entry.chunks.push(event.data);
        this.addEventListener('statechange', () => entry.states.push({ ms: performance.now() - entry.started, state: this.state }));
        recorder.start();
        const createGain = this.createGain.bind(this);
        this.createGain = () => {
          const gain = createGain();
          const connect = gain.connect.bind(gain);
          gain.connect = (target, ...rest) => {
            if (target === this.destination) connect(destination);
            return connect(target, ...rest);
          };
          return gain;
        };
      }
    };
  });
  await page.goto(`${process.argv[3] ?? 'http://127.0.0.1:4179'}/#pilot`);
  await page.locator('.pilot-grid > button').filter({ hasText: '旋律视唱' }).click();
  await page.locator('.pilot-record').click();
  await page.locator('.pilot-beat-status').filter({ hasText: '预备拍' }).waitFor();
  await page.waitForFunction(() => document.querySelector('.pilot-record')?.textContent === '重新录入', undefined, { timeout: 15000 });
  const result = await page.evaluate(async () => {
    const streams = [];
    for (const entry of window.audioRecordings) {
      if (entry.recorder.state !== 'inactive') await new Promise((resolve) => { entry.recorder.onstop = resolve; entry.recorder.stop(); });
      const data = await new Blob(entry.chunks).arrayBuffer();
      if (!data.byteLength) { streams.push({ hits: [], states: entry.states }); continue; }
      const decoder = new OfflineAudioContext(1, 1, 48000);
      let decoded;
      try { decoded = await decoder.decodeAudioData(data); }
      catch (error) { streams.push({ hits: [], decodeError: String(error), bytes: data.byteLength, states: entry.states }); continue; }
      const samples = decoded.getChannelData(0);
      const hits = [];
      for (let index = 0; index < samples.length; index += 1) {
        const time = index / decoded.sampleRate;
        if (Math.abs(samples[index]) > 0.015 && (!hits.length || time - hits[hits.length - 1] > 0.25)) hits.push(time);
      }
      streams.push({ hits, duration: decoded.duration, states: entry.states });
    }
    return { streams,
      status: document.querySelector('.pilot-capture-status').textContent };
  });
  await writeFile('dist/recording-audio-check.json', JSON.stringify(result, null, 2));
  const sounding = result.streams.filter((stream) => stream.hits.length);
  assert.equal(sounding.length, 1);
  assert.equal(sounding[0].hits.length, 9, JSON.stringify(result));
  for (let index = 1; index < sounding[0].hits.length; index += 1) assert.ok(Math.abs(sounding[0].hits[index] - sounding[0].hits[index - 1] - 2 / 3) < 0.04);
  assert.ok(await page.locator('.pilot-recording-audio').getAttribute('src'));
  assert.deepEqual(errors, []);
  console.log(`PASS ${process.argv[4] ?? 'chrome'}: actual melody-singing page, live simulated microphone, pitch processing, 9 recorded output clicks at 90 BPM; output report saved`);
} finally {
  await browser.close();
}
