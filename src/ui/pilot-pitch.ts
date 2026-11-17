import type { PitchFrame } from '../engine/ports';
import { pitchFromFrame, pitchName } from '../store/pilot';
import { pitchPosition, staffPosition, timelineX } from './pitch-geometry';

const namespace = 'http://www.w3.org/2000/svg';

export function mountPitchTrace(surface: HTMLElement, label: HTMLElement, durationMs: number, tempoBpm: number) {
  const svg = surface.querySelector<SVGSVGElement>('svg')!;
  const bottom = Number(svg.dataset.staffBottom);
  const step = Number(svg.dataset.staffStep);
  const base = svg.dataset.clef === 'bass' ? 18 : 30;
  const initialView = svg.getAttribute('viewBox')!;
  const original = initialView.split(' ').map(Number);
  let top = original[1]!;
  let end = top + original[3]!;
  const points = [...svg.querySelectorAll<SVGGElement>('[data-note-beat]')].map((note) => ({ time: Number(note.dataset.noteBeat) * 60000 / tempoBpm, x: Number(note.dataset.noteX) }));
  if (!points.length) points.push({ time: 0, x: Number(svg.dataset.timelineStart) });
  const scoreEnd = Number(svg.dataset.totalBeats ?? 0) * 60000 / tempoBpm;
  const references = [...svg.querySelectorAll<SVGGElement>('[data-note-beat]')].map((note) => ({
    time: Number(note.dataset.noteBeat) * 60000 / tempoBpm,
    end: (Number(note.dataset.noteBeat) + Number(note.dataset.noteDuration)) * 60000 / tempoBpm,
    midi: note.dataset.noteMidi ? Number(note.dataset.noteMidi) : null,
    position: staffPosition(note.dataset.noteName ?? ''),
  }));
  points.push({ time: scoreEnd || durationMs, x: Number(svg.dataset.timelineEnd) });
  const layer = document.createElementNS(namespace, 'g'); layer.classList.add('pilot-pitch-layer'); layer.setAttribute('pointer-events', 'none');
  const path = document.createElementNS(namespace, 'path'); path.classList.add('pilot-pitch-path');
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#087dcb'); path.setAttribute('stroke-width', '2.5');
  const cursor = document.createElementNS(namespace, 'line'); cursor.classList.add('pilot-pitch-cursor');
  cursor.setAttribute('stroke', '#087dcb'); cursor.setAttribute('stroke-opacity', '0.35');
  cursor.setAttribute('y1', String(bottom - step * 10)); cursor.setAttribute('y2', String(bottom + step * 3));
  const head = document.createElementNS(namespace, 'circle'); head.setAttribute('r', '4'); head.setAttribute('fill', '#087dcb');
  const ledgers = document.createElementNS(namespace, 'g'); ledgers.classList.add('pilot-pitch-ledgers');
  const drawnLedgers = new Set<number>();
  layer.append(ledgers, path, cursor, head); svg.append(layer);
  let commands = '';
  let previous: number | null = null;
  let recent: number[] = [];
  const xAt = (time: number): number => {
    return timelineX(time, points);
  };
  const seek = (time: number): void => {
    const x = xAt(time); cursor.setAttribute('x1', String(x)); cursor.setAttribute('x2', String(x));
    cursor.style.display = time < 0 ? 'none' : '';
    if (time >= 0 && surface.scrollWidth > surface.clientWidth) {
      const pixel = x * svg.getBoundingClientRect().width / original[2]!;
      if (pixel < surface.scrollLeft + 40 || pixel > surface.scrollLeft + surface.clientWidth - 60) {
        surface.scrollLeft = Math.max(0, pixel - surface.clientWidth * 0.35);
      }
    }
  };
  const reset = (): void => {
    surface.scrollLeft = 0;
    ledgers.replaceChildren(); drawnLedgers.clear();
    commands = ''; previous = null; recent = []; path.setAttribute('d', ''); head.style.display = 'none';
    label.textContent = '实时音高：等待演唱'; svg.setAttribute('viewBox', initialView); top = original[1]!; end = top + original[3]!; seek(-1);
  };
  reset();
  return {
    reset, seek,
    append(frame: PitchFrame): void {
      if (frame.t < 0 || frame.t > (scoreEnd || durationMs)) { previous = null; head.style.display = 'none'; return; }
      const pitch = pitchFromFrame(frame);
      if (pitch === null) { previous = null; recent = []; head.style.display = 'none'; label.textContent = '实时音高：未检测到稳定音高'; return; }
      if (previous !== null && frame.t - previous > 60) { previous = null; recent = []; }
      recent = [...recent.slice(-2), pitch];
      const smooth = [...recent].sort((first, second) => first - second)[Math.floor(recent.length / 2)]!;
      const reference = references.find((note) => frame.t >= note.time && frame.t < note.end);
      const position = pitchPosition(smooth, reference?.midi != null && reference.position !== null
        ? { midi: reference.midi, position: reference.position } : undefined);
      const y = bottom - (position - base) * step;
      const x = xAt(frame.t);
      const offset = position - base;
      for (let ledger = offset < 0 ? -2 : 10; offset < 0 ? ledger >= Math.floor(offset) : ledger <= Math.ceil(offset); ledger += offset < 0 ? -2 : 2) {
        if (drawnLedgers.has(ledger)) continue;
        const line = document.createElementNS(namespace, 'line');
        line.setAttribute('x1', svg.dataset.timelineStart!); line.setAttribute('x2', svg.dataset.timelineEnd!);
        line.setAttribute('y1', String(bottom - ledger * step)); line.setAttribute('y2', String(bottom - ledger * step));
        line.setAttribute('stroke', '#087dcb'); line.setAttribute('stroke-opacity', '0.25'); line.setAttribute('stroke-dasharray', '4 4');
        ledgers.append(line); drawnLedgers.add(ledger);
      }
      commands += `${previous === null ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
      path.setAttribute('d', commands); head.setAttribute('cx', String(x)); head.setAttribute('cy', String(y)); head.style.display = '';
      top = Math.min(top, y - 20); end = Math.max(end, y + 20);
      svg.setAttribute('viewBox', `${original[0]} ${top} ${original[2]} ${end - top}`);
      cursor.setAttribute('y1', String(top + 10)); cursor.setAttribute('y2', String(end - 10));
      previous = frame.t;
      const midi = Math.round(smooth);
      const cents = Math.round((smooth - midi) * 100);
      label.textContent = `实时音高：${pitchName(midi)} · ${cents > 0 ? '+' : ''}${cents}¢`;
    },
  };
}
