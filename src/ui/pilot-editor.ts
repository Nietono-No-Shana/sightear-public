import type { PresentedItem, Score, ScoreNote } from '../engine/ports';
import { pitchName, scoreView } from '../store/pilot';
import { renderPilotScore } from './pilot-score';
import { durationTicks, makeSpelled, parsePitchName, scoreTimeline, type Letter } from '../engine/theory';

const durations = [1, 2, 4, 8, 16, 32] as const;
const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value;

function pitchControls(initial: { midi: number; name: string }, label: string, changed: (pitch: { midi: number; name: string }) => void) {
  const parsed = parsePitchName(initial.name);
  if (!parsed || parsed.midi !== initial.midi) throw new RangeError('音符拼写与音高不一致');
  let current = { midi: initial.midi, name: initial.name };
  const element = document.createElement('div');
  element.className = 'row pilot-pitch-controls';
  const letter = document.createElement('select');
  letter.className = 'pilot-pitch-letter';
  letter.setAttribute('aria-label', `${label}音名`);
  for (const name of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) letter.add(new Option(name, name));
  const octave = document.createElement('select');
  octave.className = 'pilot-pitch-octave';
  octave.setAttribute('aria-label', `${label}八度`);
  for (let value = 2; value <= 6; value += 1) octave.add(new Option(String(value), String(value)));
  const accidental = document.createElement('select');
  accidental.className = 'pilot-pitch-accidental';
  accidental.setAttribute('aria-label', `${label}升降号`);
  for (const [name, value] of [['♭♭', '-2'], ['♭', '-1'], ['♮', '0'], ['♯', '1'], ['♯♯', '2']]) accidental.add(new Option(name, value));
  const sync = (pitch: { midi: number; name: string }): void => {
    const value = parsePitchName(pitch.name);
    if (!value) return;
    current = pitch;
    letter.value = value.letter;
    octave.value = String(value.octave);
    accidental.value = String(value.accidental);
  };
  const update = (): void => {
    try {
      const pitch = makeSpelled(letter.value as Letter, Number(accidental.value), Number(octave.value));
      if (pitch.midi < 36 || pitch.midi > 84) { sync(current); return; }
      current = { midi: pitch.midi, name: pitch.name };
      changed(current);
    } catch { sync(current); }
  };
  letter.addEventListener('change', update);
  octave.addEventListener('change', update);
  accidental.addEventListener('change', update);
  element.append(letter, octave, accidental);
  sync(current);
  return { element, sync };
}

export function mountPilotEditor(container: HTMLElement, context: NonNullable<PresentedItem['notationContext']>, rhythmOnly: boolean, changed: (valid: boolean) => void,
  options: { initialScore?: Score; editableMeasures?: boolean } = {}) {
  let score: Score = options.initialScore ? clone(options.initialScore) : { clef: 'treble', measures: Array.from({ length: context.measures }, () => ({
    key: { ...context.key }, time: { ...context.time }, voices: [{ notes: [] }],
  })) };
  const history: Score[] = [];
  let disabled = false;
  let currentMeasure = 0;
  let inputPitch = 60;
  let inputPitchName = 'C4';
  let inputDuration: ScoreNote['duration']['value'] = 4;
  let inputRest = false;
  let inputDotted = false;
  let inputTriplet = false;
  const units = (note: ScoreNote): number => durationTicks(note.duration) / 480;
  const total = (index: number): number => score.measures[index]!.voices[0]!.notes.reduce((sum, note) => sum + units(note), 0);
  const capacity = context.time.beats * 4 / context.time.unit;
  const remember = (): void => { history.push(clone(score)); if (history.length > 100) history.shift(); };
  function insertNote(targetMeasure?: number, targetIndex?: number): void {
    let measureIndex = currentMeasure;
    let noteIndex = score.measures[measureIndex]!.voices[0]!.notes.length;
    if (targetMeasure !== undefined && targetIndex !== undefined) {
      measureIndex = targetMeasure;
      noteIndex = targetIndex;
      currentMeasure = measureIndex;
    }
    const duration = { value: inputDuration, dots: inputDotted && !inputTriplet ? 1 as const : 0 as const,
      ...(inputTriplet ? { tuplet: { actual: 3, normal: 2 } } : {}) };
    const amount = durationTicks(duration) / 480 * (inputTriplet ? 3 : 1);
    if (total(measureIndex) + amount > capacity + 1e-7) {
      const message = container.querySelector('.pilot-capacity');
      if (message) message.textContent = '此小节放不下这个时值，请缩短时值或修改已有音符';
      return;
    }
    remember();
    const midi = rhythmOnly ? 60 : inputPitch;
    score.measures[measureIndex]!.voices[0]!.notes.splice(noteIndex, 0, ...Array.from({ length: inputTriplet ? 3 : 1 }, () => ({
      pitch: inputRest ? null : { midi, name: rhythmOnly ? pitchName(midi) : inputPitchName },
      duration: { ...duration, ...(duration.tuplet ? { tuplet: { ...duration.tuplet } } : {}) }, tie: false,
    })));
    if (total(measureIndex) === capacity && measureIndex + 1 < score.measures.length) currentMeasure = measureIndex + 1;
    render(true);
  }

  const render = (refocus = false): void => {
    container.innerHTML = `<div class="pilot-editor" tabindex="0" aria-label="音符编辑区"><div class="row"><label>小节 <select class="pilot-measure" aria-label="编辑小节"></select></label>
      <div class="pilot-pitch-input" ${rhythmOnly ? 'hidden' : ''}></div>
      <label>时值 <select class="pilot-duration" aria-label="添加时值"></select></label>
      <label><input class="pilot-rest" type="checkbox">休止</label><label><input class="pilot-add-dot" type="checkbox">附点</label>
      <label><input class="pilot-add-triplet" type="checkbox">整组三连音</label>
      <button type="button" class="button pilot-add">添加</button><button type="button" class="button pilot-undo">撤销</button><span class="muted pilot-input-state"></span></div>
      ${options.editableMeasures ? `<div class="row"><label>谱号 <select class="pilot-editor-clef" aria-label="编辑谱号"><option value="treble">高音</option><option value="bass">低音</option></select></label>
      <button class="button pilot-add-measure">新增小节</button><button class="button pilot-copy-measure">复制当前小节</button><button class="button pilot-remove-measure">删除当前小节</button></div>` : ''}
      <p class="muted pilot-capacity"></p><div class="pilot-score"></div><div class="pilot-note-list"></div></div>`;
    const measureSelect = container.querySelector<HTMLSelectElement>('.pilot-measure')!;
    score.measures.forEach((_, index) => measureSelect.add(new Option(`第 ${index + 1} 小节`, String(index))));
    measureSelect.value = String(currentMeasure);
    measureSelect.onchange = () => { currentMeasure = Number(measureSelect.value); render(); };
    const inputPitchControls = pitchControls({ midi: inputPitch, name: inputPitchName }, '添加音符', (pitch) => {
      inputPitch = pitch.midi; inputPitchName = pitch.name; updateInputState();
    });
    container.querySelector('.pilot-pitch-input')!.append(inputPitchControls.element);
    const restInput = container.querySelector<HTMLInputElement>('.pilot-rest')!;
    restInput.checked = inputRest; restInput.onchange = () => { inputRest = restInput.checked; updateInputState(); };
    const dotInput = container.querySelector<HTMLInputElement>('.pilot-add-dot')!;
    dotInput.checked = inputDotted; dotInput.disabled = inputTriplet; dotInput.onchange = () => { inputDotted = dotInput.checked; updateInputState(); };
    const durationSelect = container.querySelector<HTMLSelectElement>('.pilot-duration')!;
    durations.forEach((value) => durationSelect.add(new Option(({ 1: '全音符', 2: '二分', 4: '四分', 8: '八分', 16: '十六分', 32: '三十二分' })[value], String(value))));
    const tripletControl = container.querySelector<HTMLInputElement>('.pilot-add-triplet')!;
    tripletControl.checked = inputTriplet;
    tripletControl.onchange = () => { inputTriplet = tripletControl.checked; if (inputTriplet) inputDotted = false; render(); };
    durationSelect.value = String(inputDuration); durationSelect.onchange = () => { inputDuration = Number(durationSelect.value) as ScoreNote['duration']['value']; updateInputState(); };
    let valid = score.measures.every((_, index) => Math.abs(total(index) - capacity) < 1e-7);
    let issue = '';
    if (valid) try { scoreTimeline(score, 90); } catch { valid = false; issue = ' · 延音必须连接相同音高，不能连接休止或悬空'; }
    container.querySelector('.pilot-capacity')!.textContent = `第 ${currentMeasure + 1} 小节：${total(currentMeasure)} / ${capacity} 个四分拍${valid ? ' · 已填满' : ' · 请填满各小节并检查时值'}${issue}`;
    const surface = container.querySelector<HTMLElement>('.pilot-score')!;
    renderPilotScore(surface, scoreView(score), rhythmOnly, options.editableMeasures ? (selected) => {
      let start = 0;
      currentMeasure = score.measures.findIndex((measure) => {
        start += measure.voices[0]!.notes.length; return selected < start;
      });
      render();
    } : undefined, [], (midi, name, measure, index) => {
      inputPitch = midi;
      inputPitchName = name;
      inputRest = false;
      insertNote(measure, index);
    });
    const editorSurface = container.querySelector<HTMLElement>('.pilot-editor')!;
    const state = container.querySelector<HTMLElement>('.pilot-input-state')!;
    const updateInputState = (): void => {
      state.textContent = `${inputRest ? '休止' : inputPitchName} · 1/${inputDuration}${inputDotted ? ' 附点' : ''}${inputTriplet ? ' 三连音组' : ''}`;
      inputPitchControls.sync({ midi: inputPitch, name: inputPitchName });
      durationSelect.value = String(inputDuration);
      restInput.checked = inputRest;
      dotInput.checked = inputDotted;
    };
    updateInputState();
    editorSurface.onkeydown = (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
      const key = event.key.toLowerCase();
      const natural = ({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 } as Record<string, number>)[key];
      if (natural !== undefined && !rhythmOnly) {
        const octave = Math.floor(inputPitch / 12) - 1;
        const letter = key.toUpperCase();
        inputPitch = (octave + 1) * 12 + natural;
        inputPitchName = `${letter}${octave}`;
      } else if (key === '#') {
        if (inputPitch >= 84) return;
        inputPitch += 1; inputPitchName = `${inputPitchName.replace(/[#b]/g, '')}#`;
      } else if (key === '[' && !rhythmOnly) {
        if (inputPitch <= 36) return;
        inputPitch -= 1; inputPitchName = `${inputPitchName.replace(/[#b]/g, '')}b`;
      } else if (key === ']' && !rhythmOnly) {
        if (inputPitch >= 84) return;
        inputPitch += 1; inputPitchName = `${inputPitchName.replace(/[#b]/g, '')}#`;
      } else if (key === 'n' && !rhythmOnly) {
        inputPitchName = inputPitchName.replace(/[#b]/g, '');
        inputPitch = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[inputPitchName[0] as 'C']! + (Number(inputPitchName.slice(-1)) + 1) * 12);
      } else if (key === 'arrowup' || key === 'arrowdown') {
        const shift = key === 'arrowup' ? 12 : -12;
        if (inputPitch + shift < 36 || inputPitch + shift > 84) return;
        inputPitch += shift; inputPitchName = inputPitchName.replace(/-?\d+$/, String(Number(inputPitchName.match(/-?\d+$/)?.[0] ?? '4') + shift / 12));
      } else if (['1', '2', '4', '8', '6'].includes(key)) {
        inputDuration = (key === '6' ? 16 : Number(key)) as ScoreNote['duration']['value'];
      } else if (key === '.') inputDotted = !inputDotted;
      else if (key === 'r') inputRest = !inputRest;
      else if (key === 'enter') { event.preventDefault(); insertNote(); return; }
      else if (key === 'backspace' && !event.ctrlKey && !event.metaKey) {
        const notes = score.measures[currentMeasure]!.voices[0]!.notes;
        if (notes.length) { event.preventDefault(); remember(); notes.pop(); render(true); return; }
      } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault(); const previous = history.pop(); if (previous) { score = previous; currentMeasure = Math.min(currentMeasure, score.measures.length - 1); render(true); } return;
      } else return;
      event.preventDefault(); updateInputState();
    };
    if (options.editableMeasures) {
      const marker = surface.querySelector<SVGElement>(`[data-measure-index="${currentMeasure}"]`)!;
      surface.scrollLeft = currentMeasure === 0 ? 0 : Math.max(0, Number(marker.getAttribute('data-measure-x')) - 100);
    }
    const list = container.querySelector<HTMLElement>('.pilot-note-list')!;
    score.measures[currentMeasure]!.voices[0]!.notes.forEach((note, index) => {
      const row = document.createElement('div'); row.className = 'row pilot-note-row';
      const label = document.createElement('span'); label.textContent = `${index + 1}.`; row.append(label);
      let notePitch: HTMLElement;
      if (rhythmOnly) {
        const sound = document.createElement('select'); sound.setAttribute('aria-label', `第 ${index + 1} 音发声或休止`);
        sound.add(new Option('休止', 'rest')); sound.add(new Option('发声', 'sound')); sound.value = note.pitch ? 'sound' : 'rest';
        sound.onchange = () => { remember(); note.pitch = sound.value === 'rest' ? null : { midi: 60, name: pitchName(60) }; if (!note.pitch) note.tie = false; render(); };
        notePitch = sound;
      } else {
        const controls = document.createElement('div'); controls.className = 'row pilot-note-pitch-controls';
        const mode = document.createElement('select'); mode.setAttribute('aria-label', `第 ${index + 1} 音类型`);
        mode.add(new Option('音符', 'sound')); mode.add(new Option('休止', 'rest')); mode.value = note.pitch ? 'sound' : 'rest';
        mode.onchange = () => {
          remember();
          note.pitch = mode.value === 'rest' ? null : { midi: inputPitch, name: inputPitchName };
          if (!note.pitch) note.tie = false;
          render();
        };
        controls.append(mode);
        if (note.pitch) controls.append(pitchControls(note.pitch, `第 ${index + 1} 音`, (pitch) => { remember(); note.pitch = pitch; render(); }).element);
        notePitch = controls;
      }
      const duration = document.createElement('select'); duration.setAttribute('aria-label', `第 ${index + 1} 音时值`);
      durations.forEach((value) => duration.add(new Option(`1/${value}`, String(value)))); duration.value = String(note.duration.value);
      duration.onchange = () => { remember(); note.duration.value = Number(duration.value) as ScoreNote['duration']['value']; render(); };
      const dotted = document.createElement('label'); const dot = document.createElement('input'); dot.type = 'checkbox'; dot.checked = note.duration.dots === 1;
      dot.onchange = () => { remember(); note.duration.dots = dot.checked ? 1 : 0; render(); }; dotted.append(dot, '附点');
      const doubleDot = document.createElement('label'); const double = document.createElement('input'); double.type = 'checkbox'; double.checked = note.duration.dots === 2;
      double.onchange = () => { remember(); note.duration.dots = double.checked ? 2 : 0; render(); }; doubleDot.append(double, '双附点');
      const tied = document.createElement('label'); const tie = document.createElement('input'); tie.type = 'checkbox'; tie.checked = note.tie; tie.disabled = note.pitch === null;
      tie.onchange = () => { remember(); note.tie = tie.checked; render(); }; tied.append(tie, '延音至下一音');
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button'; remove.textContent = '删除'; remove.setAttribute('aria-label', `删除第 ${index + 1} 音`);
      remove.onclick = () => { remember(); score.measures[currentMeasure]!.voices[0]!.notes.splice(index, 1); render(); };
      row.append(notePitch, duration, dotted, doubleDot, tied, remove); list.append(row);
      for (const offset of [-1, 1]) {
        const move = document.createElement('button'); move.type = 'button'; move.className = 'button'; move.textContent = offset < 0 ? '前移' : '后移';
        const notes = score.measures[currentMeasure]!.voices[0]!.notes;
        move.disabled = index + offset < 0 || index + offset >= notes.length;
        move.onclick = () => { remember(); notes.splice(index, 1); notes.splice(index + offset, 0, note); render(); }; row.append(move);
      }
    });
    const undo = container.querySelector<HTMLButtonElement>('.pilot-undo')!; undo.disabled = history.length === 0;
    undo.onclick = () => { const previous = history.pop(); if (previous) score = previous; currentMeasure = Math.min(currentMeasure, score.measures.length - 1); render(); };
    if (options.editableMeasures) {
      const clef = container.querySelector<HTMLSelectElement>('.pilot-editor-clef')!; clef.value = score.clef;
      clef.onchange = () => { remember(); score.clef = clef.value as Score['clef']; render(); };
      for (const action of ['add', 'copy', 'remove']) {
        const control = container.querySelector<HTMLButtonElement>(`.pilot-${action}-measure`)!;
        control.disabled = action === 'remove' ? score.measures.length === 1 : score.measures.length >= 8;
        control.onclick = () => {
          remember();
          if (action === 'remove') score.measures.splice(currentMeasure, 1);
          else {
            const measure = clone(score.measures[currentMeasure]!);
            if (action === 'add') measure.voices[0]!.notes = [];
            score.measures.splice(currentMeasure + 1, 0, measure); currentMeasure += 1;
          }
          currentMeasure = Math.min(currentMeasure, score.measures.length - 1); render();
        };
      }
    }
    container.querySelector<HTMLButtonElement>('.pilot-add')!.onclick = () => insertNote();
    if (disabled) container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button').forEach((control) => { control.disabled = true; });
    changed(valid && !disabled);
    if (refocus) container.querySelector<HTMLElement>('.pilot-editor')?.focus();
  };
  render();
  return { score: () => clone(score), disable: () => { disabled = true; render(); } };
}
