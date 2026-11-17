import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.argv[3] ?? 'http://127.0.0.1:4179');
  const results = await page.evaluate(async () => {
    const { renderPilotScore } = await import('/src/ui/pilot-score.ts');
    const { mountPitchTrace } = await import('/src/ui/pilot-pitch.ts');
    document.body.replaceChildren();
    const results = [];
    for (const clef of ['treble', 'bass']) {
      const octave = clef === 'bass' ? 2 : 4;
      const base = (octave + 1) * 12;
      const notes = [
        { midi: base + 1, name: `C#${octave}`, duration: { value: 4, dots: 1 }, tie: false },
        { midi: base + 1, name: `Db${octave}`, duration: { value: 8, dots: 0 }, tie: false },
        { midi: null, name: '', duration: { value: 4, dots: 0 }, tie: false },
        { midi: base + 4, name: `E${octave}`, duration: { value: 8, dots: 0, tuplet: { actual: 3, normal: 2 } }, tie: true },
        { midi: base + 4, name: `E${octave}`, duration: { value: 8, dots: 0, tuplet: { actual: 3, normal: 2 } }, tie: false },
        { midi: base + 5, name: `F${octave}`, duration: { value: 8, dots: 0, tuplet: { actual: 3, normal: 2 } }, tie: false },
      ];
      const surface = document.createElement('div');
      const label = document.createElement('p');
      document.body.append(surface, label);
      renderPilotScore(surface, { clef, measures: [{ time: { beats: 4, unit: 4 }, key: { tonic: 'C', mode: 'major' }, voices: [{ notes }] }] });
      const trace = mountPitchTrace(surface, label, 2450, 120);
      const groups = [...surface.querySelectorAll('[data-note-beat]')];
      const checks = [];
      const sample = (midi, time) => trace.append({ t: time, f0: 440 * 2 ** ((midi - 69) / 12), clarity: 1, rms: 0.2 });
      for (const [index, group] of groups.entries()) {
        const time = Number(group.dataset.noteBeat) * 500;
        const end = time + Number(group.dataset.noteDuration) * 500;
        trace.seek(time);
        const cursorX = Number(surface.querySelector('.pilot-pitch-cursor').getAttribute('x1'));
        if (notes[index].midi === null) { checks.push({ cursorX, noteX: Number(group.dataset.noteX) }); continue; }
        const midi = notes[index].midi;
        sample(midi, time);
        sample(midi, time + 20);
        sample(midi, time + 40);
        const headY = Number(surface.querySelector('.pilot-pitch-layer circle').getAttribute('cy'));
        checks.push({ cursorX, noteX: Number(group.dataset.noteX), headY, noteY: Number(group.querySelector('ellipse').getAttribute('cy')) });
        for (let elapsed = time + 60; elapsed < end - 10; elapsed += 20) sample(midi, elapsed);
      }
      const path = surface.querySelector('.pilot-pitch-path');
      const beforeTail = path.getAttribute('d');
      sample(base + 12, 2200);
      const tailUnchanged = beforeTail === path.getAttribute('d');
      for (const time of [1940, 1960, 1980]) sample(base - 12, time);
      const lowY = Number(surface.querySelector('.pilot-pitch-layer circle').getAttribute('cy'));
      const view = surface.querySelector('svg').getAttribute('viewBox').split(' ').map(Number);
      const ledgerCount = surface.querySelectorAll('.pilot-pitch-ledgers line').length;
      results.push({ clef, checks, tailUnchanged, lowVisible: lowY >= view[1] && lowY <= view[1] + view[3], ledgerCount,
        widths: groups.slice(0, 3).map((group) => Number(group.dataset.noteX)) });
    }
    return results;
  });
  for (const result of results) {
    for (const check of result.checks) {
      assert.ok(Math.abs(check.cursorX - check.noteX) < 0.001);
      if (check.headY !== undefined) assert.ok(Math.abs(check.headY - check.noteY) < 0.001, JSON.stringify(check));
    }
    assert.equal(result.tailUnchanged, true);
    assert.equal(result.lowVisible, true);
    assert.ok(result.ledgerCount > 0);
    assert.ok(Math.abs((result.widths[1] - result.widths[0]) / (result.widths[2] - result.widths[1]) - 3) < 0.001);
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'dist/pitch-alignment.png', fullPage: true });
  console.log('PASS: treble/bass pitch traces align with spelled noteheads; dotted, rest, tied and tuplet timing; no tail pile-up');
} finally {
  await browser.close();
}
