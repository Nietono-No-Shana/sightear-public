import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${process.argv[3] ?? 'http://127.0.0.1:4179'}/#pilot`);
  const result = await page.evaluate(async () => {
    const { mountPilotMetronome } = await import('/src/ui/pilot-metronome.ts');
    const NativeAudioContext = window.AudioContext;
    const nativeInterval = window.setInterval.bind(window);
    let context;
    let destination;
    let recorder;
    const chunks = [];
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        context = this;
        destination = this.createMediaStreamDestination();
        recorder = new MediaRecorder(destination.stream);
        recorder.ondataavailable = (event) => chunks.push(event.data);
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
    window.setInterval = (callback, delay, ...args) => nativeInterval(delay === 25 ? () => {} : callback, delay, ...args);
    const host = document.createElement('div'); document.body.append(host);
    const lifetime = new AbortController();
    const metronome = mountPilotMetronome(host, { features: { tempoBpm: 90 }, notationContext: { time: { beats: 4, unit: 4 } }, exerciseKind: 'melody-singing' }, lifetime.signal, () => {});
    try {
      await metronome.prepare();
      const beat = 60000 / 90;
      metronome.follow(performance.now() + 150 + 4 * beat, 4 * beat, 4 * beat + 450);
      await new Promise((resolve) => setTimeout(resolve, 6400));
      metronome.stop();
      await new Promise((resolve) => { recorder.onstop = resolve; recorder.stop(); });
      const bytes = await new Blob(chunks).arrayBuffer();
      const decoded = await context.decodeAudioData(bytes);
      const samples = decoded.getChannelData(0);
      const hits = [];
      for (let index = 0; index < samples.length; index += 1) {
        const time = index / decoded.sampleRate;
        if (Math.abs(samples[index]) > 0.015 && (!hits.length || time - hits[hits.length - 1] > 0.25)) hits.push(time);
      }
      return { hits, duration: decoded.duration };
    } finally {
      lifetime.abort(); host.remove();
      window.AudioContext = NativeAudioContext;
      window.setInterval = nativeInterval;
    }
  });
  assert.equal(result.hits.length, 9, `expected four count-in clicks and five recording-window clicks; got ${JSON.stringify(result)}`);
  for (let index = 1; index < result.hits.length; index += 1) assert.ok(Math.abs(result.hits[index] - result.hits[index - 1] - 2 / 3) < 0.04);
  console.log(`PASS recorded ${result.hits.length} audible clicks at 90 BPM with all 25ms visual/scheduling timers suppressed`);
} finally {
  await browser.close();
}
