import type { ScoreViewModel } from '../engine/ports';
import { durationBeats, keySignatureMarks, staffPosition } from './pitch-geometry';
import { scoreLinks, type ScorePosition } from './score-links';

const namespace = 'http://www.w3.org/2000/svg';
function svgNode(tag: string, attributes: Record<string, string | number>, text?: string): SVGElement {
  const element = document.createElementNS(namespace, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

export function renderPilotScore(container: HTMLElement, score: ScoreViewModel, rhythmOnly = false, choose?: (index: number) => void, selected: readonly number[] = [], staffInput?: (midi: number, name: string, measure: number, index: number) => void): void {
  const durations = score.measures.flatMap((measure) => (measure.voices[0]?.notes ?? []).map((note) => durationBeats(note.duration)));
  const measureBeats = score.measures.map((measure) => Math.max(measure.time.beats * 4 / measure.time.unit,
    (measure.voices[0]?.notes ?? []).reduce((sum, note) => sum + durationBeats(note.duration), 0)));
  const totalBeats = measureBeats.reduce((sum, beats) => sum + beats, 0);
  const beatWidth = Math.max(80 / Math.min(1, ...durations), 400 / (totalBeats || 1));
  const measureSizes = measureBeats.map((beats) => beats * beatWidth);
  const width = 240 + totalBeats * beatWidth;
  const noteYs = rhythmOnly ? [] : score.measures.flatMap((measure) => (measure.voices[0]?.notes ?? [])
    .flatMap((note) => note.midi === null ? [] : [128 - ((staffPosition(note.name) ?? 34) - (score.clef === 'bass' ? 18 : 30)) * 7]));
  const top = Math.min(0, ...noteYs.map((value) => value - 65));
  const bottom = Math.max(230, ...noteYs.map((value) => value + 60));
  const svg = svgNode('svg', { viewBox: `0 ${top} ${width} ${bottom - top}`, role: 'img', 'aria-label': rhythmOnly ? '节奏谱面' : '旋律谱面' }) as SVGSVGElement;
  svg.classList.add('pilot-score-svg');
  svg.style.minWidth = `${Math.max(560, width)}px`;
  svg.setAttribute('data-clef', score.clef);
  svg.setAttribute('data-staff-bottom', '128');
  svg.setAttribute('data-staff-step', '7');
  svg.setAttribute('data-timeline-start', '220');
  svg.setAttribute('data-timeline-end', String(width - 20));
  for (let line = 0; line < 5; line += 1) svg.append(svgNode('line', { x1: 20, x2: width - 20, y1: 72 + line * 14, y2: 72 + line * 14, stroke: '#777' }));
  const bass = score.clef === 'bass' && !rhythmOnly;
  svg.append(svgNode('text', { x: 25, y: bass ? 86 : 114, 'font-family': 'Bravura', 'font-size': 56, fill: '#222' }, bass ? '\uE062' : '\uE050'));
  const firstKey = score.measures[0]?.key;
  const marks = firstKey && !rhythmOnly ? keySignatureMarks(firstKey.fifths, score.clef) : [];
  const time = score.measures[0]?.time;
  const timeX = 85 + marks.length * 13;
  svg.append(svgNode('text', { x: timeX, y: 92, 'font-size': 23, fill: '#222' }, String(time?.beats ?? 4)));
  svg.append(svgNode('text', { x: timeX, y: 119, 'font-size': 23, fill: '#222' }, String(time?.unit ?? 4)));
  const sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  if (firstKey && !rhythmOnly) {
    const glyph = firstKey.fifths >= 0 ? '\uE262' : '\uE260';
    marks.forEach((mark, index) => {
      svg.append(svgNode('text', { x: 70 + index * 13, y: 128 - mark.step * 7, 'font-family': 'Bravura', 'font-size': 20, fill: '#222' }, glyph));
    });
    const keyAlteration = new Set(marks.map((mark) => mark.letter));
    svg.setAttribute('data-key-fifths', String(firstKey.fifths));
    svg.setAttribute('data-key-accidentals', String(keyAlteration.size));
  }
  let index = 0;
  let elapsedBeats = 0;
  let x = 220;
  const positions: ScorePosition[] = [];
  for (const [measureIndex, measure] of score.measures.entries()) {
    const measureStart = x;
    const beatStart = elapsedBeats;
    const order = measure.key.fifths >= 0 ? sharpOrder : flatOrder;
    const accidentalByLetter = new Map<string, number>(order.slice(0, Math.abs(measure.key.fifths)).map((letter) => [letter, measure.key.fifths > 0 ? 1 : -1]));
    const accidentalState = new Map<string, number>();
    const measureMarker = svgNode('text', { x: x - 24, y: 20, 'font-size': 12, fill: '#777', 'data-measure-index': measureIndex,
      'data-measure-x': measureStart, 'data-measure-end-x': measureStart + measureSizes[measureIndex]!, 'data-note-start': index }, String(measureIndex + 1));
    svg.append(measureMarker);
    for (const note of measure.voices[0]?.notes ?? []) {
      const currentIndex = index;
      const beats = durationBeats(note.duration);
      const group = svgNode('g', { 'data-note-index': index, 'data-note-x': x, 'data-note-beat': elapsedBeats,
        'data-note-duration': beats, 'data-note-midi': note.midi ?? '', 'data-note-name': note.name });
      elapsedBeats += beats;
      if (choose) {
        group.setAttribute('role', 'button');
        group.setAttribute('tabindex', '0');
        group.setAttribute('aria-label', `位置 ${index + 1}`);
        group.setAttribute('aria-pressed', String(selected.includes(index)));
        group.style.cursor = 'pointer';
        group.addEventListener('click', () => choose(currentIndex));
        group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(currentIndex); } });
      }
      group.append(svgNode('rect', { x: x - 29, y: 30, width: 64, height: 175, rx: 8, fill: selected.includes(index) ? '#b9d0ff' : 'transparent' }));
      const match = /^([A-G])([#b]*)(-?\d+)$/.exec(note.name);
      const step = note.midi === null || rhythmOnly ? 4 : match ? Number(match[3]) * 7 + 'CDEFGAB'.indexOf(match[1]!) - (bass ? 18 : 30) : 4;
      const y = 128 - step * 7;
      positions.push({ x, y, duration: note.duration, tie: note.tie, measure: measureIndex });
      if (note.midi === null) {
        const glyph = ({ 1: '\uE4E3', 2: '\uE4E4', 4: '\uE4E5', 8: '\uE4E6', 16: '\uE4E7', 32: '\uE4E8' } as const)[note.duration.value];
        group.append(svgNode('text', { x: x - 8, y: 100, 'font-family': 'Bravura', 'font-size': 56, fill: '#222' }, glyph));
      } else {
        for (let ledger = step < 0 ? -2 : 10; step < 0 ? ledger >= step : ledger <= step; ledger += step < 0 ? -2 : 2) {
          group.append(svgNode('line', { x1: x - 14, x2: x + 14, y1: 128 - ledger * 7, y2: 128 - ledger * 7, stroke: '#555' }));
        }
        group.append(svgNode('ellipse', { cx: x, cy: y, rx: 9, ry: 6, fill: note.duration.value <= 2 ? '#fffaf0' : '#222', stroke: '#222', 'stroke-width': 2, transform: `rotate(-15 ${x} ${y})` }));
        const down = step >= 4 && !rhythmOnly;
        const stemX = x + (down ? -8 : 8);
        const stemEnd = y + (down ? 42 : -42);
        if (note.duration.value > 1) group.append(svgNode('line', { x1: stemX, x2: stemX, y1: y, y2: stemEnd, stroke: '#222', 'stroke-width': 2 }));
        const flags = note.duration.value >= 8 ? Math.log2(note.duration.value) - 2 : 0;
        for (let flag = 0; flag < flags; flag += 1) group.append(svgNode('path', { d: `M ${stemX} ${stemEnd + (down ? -1 : 1) * flag * 9} q 25 ${down ? -12 : 12} 6 ${down ? -29 : 29}`, stroke: '#222', fill: 'none', 'stroke-width': 3 }));
        if (!rhythmOnly && match) {
          const letter = match[1]!;
          const suffix = match[2] ?? '';
          const alteration = suffix.length === 0 ? 0 : suffix[0] === '#' ? suffix.length : -suffix.length;
          const defaultAlteration = accidentalByLetter.get(letter) ?? 0;
          const accidentalKey = `${letter}${match[3]}`;
          const currentAlteration = accidentalState.get(accidentalKey) ?? defaultAlteration;
          if (alteration !== currentAlteration) {
            const glyph = ({ '-2': '\uE264', '-1': '\uE260', 0: '\uE261', 1: '\uE262', 2: '\uE263' } as const)[alteration as -2 | -1 | 0 | 1 | 2];
            group.append(svgNode('text', { x: x - 13, y: y + 6, 'text-anchor': 'end', 'font-family': 'Bravura', 'font-size': 22, fill: '#222' }, glyph));
          }
          accidentalState.set(accidentalKey, alteration);
        }
      }
      for (let dot = 0; dot < note.duration.dots; dot += 1) group.append(svgNode('circle', { cx: x + 18 + dot * 6, cy: y - (step % 2 === 0 ? 7 : 0), r: 2, fill: '#222' }));
      if (choose) group.append(svgNode('text', { x, y: 195, 'text-anchor': 'middle', 'font-size': 13, fill: '#555' }, String(index + 1)));
      svg.append(group);
      index += 1;
      x += beats * beatWidth;
    }
    x = measureStart + measureSizes[measureIndex]!;
    measureMarker.setAttribute('data-note-end', String(index));
    elapsedBeats = beatStart + measureBeats[measureIndex]!;
    const barX = measureIndex === score.measures.length - 1 ? width - 20 : x - 24;
    svg.append(svgNode('line', { x1: barX, x2: barX, y1: 72, y2: 128, stroke: '#555' }));
  }
  svg.setAttribute('data-total-beats', String(elapsedBeats));
  const links = scoreLinks(positions);
  for (const { from, to } of links.ties) svg.append(svgNode('path', {
    d: `M ${from.x + 8} ${from.y + 12} Q ${(from.x + to.x) / 2} ${Math.max(from.y, to.y) + 34} ${to.x - 8} ${to.y + 12}`,
    fill: 'none', stroke: '#222', 'stroke-width': 2, 'data-notation-tie': 'true',
  }));
  for (const { from, to, count } of links.tuplets) {
    svg.append(svgNode('path', { d: `M ${from.x - 10} 35 v -7 H ${to.x + 10} v 7`, fill: 'none', stroke: '#222', 'data-tuplet-group': count }));
    svg.append(svgNode('text', { x: (from.x + to.x) / 2, y: 23, 'text-anchor': 'middle', 'font-size': 15, fill: '#222' }, String(count)));
  }
  if (staffInput) svg.addEventListener('click', (event) => {
    if ((event.target as Element).closest('g[data-note-index]')) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const local = point.matrixTransform(matrix.inverse());
    const step = (score.clef === 'bass' ? 18 : 30) + Math.round((128 - local.y) / 7);
    const letterIndex = ((step % 7) + 7) % 7;
    const octave = Math.floor(step / 7);
    const semitone = [0, 2, 4, 5, 7, 9, 11][letterIndex]!;
    const midi = (octave + 1) * 12 + semitone;
    if (midi < 36 || midi > 84) return;
    const measures = [...svg.querySelectorAll<SVGElement>('[data-measure-index]')];
    const measureIndex = measures.findIndex((marker, index) => {
      const end = Number(marker.getAttribute('data-measure-end-x'));
      return local.x >= Number(marker.getAttribute('data-measure-x')) && (local.x < end || index === measures.length - 1);
    });
    if (measureIndex < 0) return;
    const marker = measures[measureIndex]!;
    const start = Number(marker.getAttribute('data-note-start'));
    const end = Number(marker.getAttribute('data-note-end'));
    const notes = [...svg.querySelectorAll<SVGGElement>('g[data-note-index]')]
      .filter((note) => Number(note.getAttribute('data-note-index')) >= start && Number(note.getAttribute('data-note-index')) < end);
    const next = notes.find((note) => Number(note.getAttribute('data-note-x')) >= local.x);
    const localIndex = next ? Number(next.getAttribute('data-note-index')) - start : end - start;
    staffInput(midi, `${'CDEFGAB'[letterIndex]}${octave}`, measureIndex, localIndex);
  });
  container.replaceChildren(svg);
}
