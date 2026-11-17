import type { Clef, Pitch } from '../engine/ports';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 640;
const HEIGHT = 220;
const STAFF_LEFT = 70;
const STAFF_RIGHT = 620;
const BOTTOM_LINE = 148;
const LINE_GAP = 18;

const TREBLE_BOTTOM_INDEX = 4 * 7 + 2; // E4
const BASS_BOTTOM_INDEX = 2 * 7 + 4; // G2

interface Spelled {
  readonly letter: number;
  readonly accidental: number;
  readonly octave: number;
}

function parseSpelling(name: string): Spelled | null {
  const match = /^([A-G])([#b]*)(-?\d+)$/.exec(name);
  if (match?.[1] === undefined || match[3] === undefined) return null;
  const letters: Readonly<Record<string, number>> = {
    C: 0,
    D: 1,
    E: 2,
    F: 3,
    G: 4,
    A: 5,
    B: 6,
  };
  const letter = letters[match[1]];
  if (letter === undefined) return null;
  let accidental = 0;
  for (const char of match[2] ?? '') {
    accidental += char === '#' ? 1 : -1;
  }
  return { letter, accidental, octave: Number.parseInt(match[3], 10) };
}

function chooseClef(pitches: readonly Pitch[]): Clef {
  if (pitches.length === 0) return 'treble';
  const average = pitches.reduce((sum, pitch) => sum + pitch.midi, 0) / pitches.length;
  return average < 60 ? 'bass' : 'treble';
}

export function clefFor(pitches: readonly Pitch[]): Clef {
  return chooseClef(pitches);
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string | number>>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function drawStaff(svg: SVGSVGElement): void {
  for (let line = 0; line < 5; line += 1) {
    svg.append(
      svgElement('line', {
        x1: STAFF_LEFT,
        x2: STAFF_RIGHT,
        y1: BOTTOM_LINE - line * LINE_GAP,
        y2: BOTTOM_LINE - line * LINE_GAP,
        stroke: '#c8c3b8',
        'stroke-width': 1,
      }),
    );
  }
}

function drawClef(svg: SVGSVGElement, clef: Clef): void {
  const clefY =
    clef === 'bass'
      ? BOTTOM_LINE - 3 * LINE_GAP // F3: bass clef dots bracket this line
      : BOTTOM_LINE - LINE_GAP; // G4: treble clef spiral surrounds this line
  const text = svgElement('text', {
    x: STAFF_LEFT - 6,
    y: clefY,
    fill: '#2a2823',
    'font-size': 4 * LINE_GAP,
    'font-family': 'Bravura, serif',
    'text-anchor': 'start',
    'dominant-baseline': 'alphabetic',
  });
  text.textContent = clef === 'bass' ? '\uE062' : '\uE050';
  svg.append(text);
}

function drawLedger(svg: SVGSVGElement, x: number, step: number): void {
  for (let ledger = step < 0 ? -2 : 10; step < 0 ? ledger >= step : ledger <= step; ledger += step < 0 ? -2 : 2) {
    const lineY = BOTTOM_LINE - ledger * (LINE_GAP / 2);
    svg.append(
    svgElement('line', {
      x1: x - 18,
      x2: x + 18,
      y1: lineY,
      y2: lineY,
      stroke: '#c8c3b8',
      'stroke-width': 1,
    }),
    );
  }
}

function accidentalGlyph(value: number): string {
  if (value === 2) return '𝄪';
  if (value === -2) return '𝄫';
  if (value === 1) return '♯';
  if (value === -1) return '♭';
  return '';
}

export interface StaffOptions {
  readonly clef?: Clef;
  readonly layout?: 'chord' | 'sequence';
  readonly groups?: readonly (readonly Pitch[])[];
}

export function renderStaff(
  container: HTMLElement,
  pitches: readonly Pitch[],
  options: StaffOptions = {},
): void {
  const clef = options.clef ?? chooseClef(pitches);
  const groups = options.groups ?? (options.layout === 'sequence' ? pitches.map((pitch) => [pitch]) : [pitches]);
  const bottomIndex = clef === 'bass' ? BASS_BOTTOM_INDEX : TREBLE_BOTTOM_INDEX;
  const steps = pitches.flatMap((pitch) => {
    const spelling = parseSpelling(pitch.name);
    return spelling ? [spelling.octave * 7 + spelling.letter - bottomIndex] : [];
  });
  const top = Math.min(0, BOTTOM_LINE - Math.max(8, ...steps) * LINE_GAP / 2 - 30);
  const bottom = Math.max(HEIGHT, BOTTOM_LINE - Math.min(0, ...steps) * LINE_GAP / 2 + 30);
  const svg = svgElement('svg', {
    viewBox: `0 ${top} ${WIDTH} ${bottom - top}`,
    role: 'img',
    'aria-label': pitches.length === 0 ? '空谱面' : options.layout === 'sequence' ? '音高序列谱面' : '和弦谱面',
  });
  svg.classList.add('staff-svg');
  svg.setAttribute('data-clef', clef);
  svg.setAttribute('data-staff-bottom', String(BOTTOM_LINE));
  svg.setAttribute('data-staff-step', String(LINE_GAP / 2));
  svg.setAttribute('data-timeline-start', '180');
  svg.setAttribute('data-timeline-end', String(STAFF_RIGHT - 20));
  svg.style.background = '#f5f1e8';
  svg.style.borderRadius = '8px';
  drawStaff(svg);
  drawClef(svg, clef);

  groups.forEach((group, groupIndex) => {
  const x = groups.length === 1 ? WIDTH / 2 : 180 + groupIndex * (STAFF_RIGHT - 210) / Math.max(1, groups.length - 1);
  const drawable = group
    .map((pitch) => ({ pitch, spelled: parseSpelling(pitch.name) }))
    .filter((entry): entry is { pitch: Pitch; spelled: Spelled } => entry.spelled !== null)
    .sort((a, b) => a.pitch.midi - b.pitch.midi);

  let previousStep: number | null = null;
  let shifted = false;
  for (const { spelled } of drawable) {
    const index = spelled.octave * 7 + spelled.letter;
    const step = index - bottomIndex;
    const y = BOTTOM_LINE - step * (LINE_GAP / 2);
    shifted = previousStep !== null && step - previousStep === 1 && !shifted;
    const noteX = x + (shifted ? 16 : 0);
    previousStep = step;
    drawLedger(svg, noteX, step);
    svg.append(
      svgElement('ellipse', {
        cx: noteX,
        cy: y,
        rx: 9,
        ry: 6,
        fill: '#2a2823',
        stroke: '#2a2823',
        'stroke-width': 1,
      }),
    );
    const glyph = accidentalGlyph(spelled.accidental);
    if (glyph !== '') {
      const accidental = svgElement('text', {
        x: x - 24,
        y: y + 6,
        fill: '#2a2823',
        'font-size': 20,
        'font-family': 'serif',
      });
      accidental.textContent = glyph;
      svg.append(accidental);
    }
  }
  });

  container.replaceChildren(svg);
}
