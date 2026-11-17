import type { Score, TimbreId } from '../engine/ports';
import { scoreTimeline } from '../engine/theory';
import { customPilotCase, type PilotCase } from '../store/pilot';
import type { WebAudioOut } from '../adapters/audio';
import { mountPilotEditor } from './pilot-editor';

export interface ComposerDraft { score: Score; tempoBpm: number }

export function mountPilotComposer(container: HTMLElement, audio: WebAudioOut, timbre: TimbreId, signal: AbortSignal,
  initial: ComposerDraft | null, saveDraft: (draft: ComposerDraft) => void, practice: (example: PilotCase) => void, back: () => void): void {
  container.innerHTML = `<section class="panel pilot"><div class="row"><button class="button composer-back">题型列表</button><h2>简易音符编辑器</h2></div>
    <p class="muted">单声部 · 4/4 · 1–8 小节 · 完整乐谱可导出保存 · 试唱使用全局演唱音区</p>
    <div class="row"><label>速度 <input class="composer-tempo" aria-label="编辑速度" type="number" min="40" max="200" value="${initial?.tempoBpm ?? 90}"></label>
    <button class="button composer-play" disabled>试听旋律</button><button class="button composer-stop" disabled>停止试听</button>
    <button class="button composer-practice" disabled>开始试唱</button><button class="button composer-export" disabled>导出乐谱</button>
    <label class="button">导入乐谱<input class="composer-import" type="file" accept="application/json,.json" aria-label="导入乐谱" hidden></label></div>
    <p class="composer-status" role="status"></p><div class="composer-editor"></div></section>`;
  const find = <ElementType extends HTMLElement>(selector: string): ElementType => container.querySelector<ElementType>(selector)!;
  const status = find('.composer-status');
  const tempo = find<HTMLInputElement>('.composer-tempo');
  let editor: ReturnType<typeof mountPilotEditor> | null = null;
  let valid = false;
  let previewTimer = 0;
  const stopButton = find<HTMLButtonElement>('.composer-stop');
  const stopPreview = (): void => {
    window.clearTimeout(previewTimer);
    audio.stop();
    stopButton.disabled = true;
  };
  const draft = (): ComposerDraft => ({ score: editor!.score(), tempoBpm: Number(tempo.value) });
  const update = (): void => {
    stopPreview();
    const value = Number(tempo.value);
    const enabled = valid && Number.isFinite(value) && value >= 40 && value <= 200;
    for (const selector of ['.composer-play', '.composer-practice', '.composer-export']) find<HTMLButtonElement>(selector).disabled = !enabled;
    status.textContent = enabled ? '' : valid ? '速度需在 40–200 BPM 之间' : '请补齐各小节时值';
    if (editor) saveDraft(draft());
  };
  const mount = (score?: Score): void => {
    editor = null;
    editor = mountPilotEditor(find('.composer-editor'), {
      key: { tonic: 0, mode: 'major', fifths: 0 }, time: { beats: 4, unit: 4 }, measures: 1,
    }, false, (ready) => { valid = ready; update(); }, { editableMeasures: true, ...(score ? { initialScore: score } : {}) });
    update();
  };
  const validate = (): PilotCase => customPilotCase(editor!.score(), Number(tempo.value));
  mount(initial?.score);
  tempo.addEventListener('input', update, { signal });
  find('.composer-back').addEventListener('click', back, { signal });
  stopButton.addEventListener('click', () => { stopPreview(); status.textContent = '已停止'; }, { signal });
  find('.composer-play').addEventListener('click', () => {
    void (async () => {
      try {
        validate(); const timeline = scoreTimeline(editor!.score(), Number(tempo.value));
        await audio.resume(); if (signal.aborted) return;
        stopPreview(); audio.schedule(timeline.notes.map((note) => ({ kind: 'note', midi: note.midi, start: note.start, dur: note.dur, velocity: 0.7, timbre })), audio.now());
        stopButton.disabled = false;
        status.textContent = '正在试听';
        previewTimer = window.setTimeout(() => {
          stopButton.disabled = true;
          status.textContent = '试听结束';
        }, timeline.end + 100);
      } catch (error) { status.textContent = error instanceof Error ? error.message : '无法试听'; }
    })();
  }, { signal });
  find('.composer-practice').addEventListener('click', () => {
    try { practice(validate()); } catch (error) { status.textContent = error instanceof Error ? error.message : '无法开始试唱'; }
  }, { signal });
  find('.composer-export').addEventListener('click', () => {
    try {
      validate();
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 'sightear-score-1', ...draft() }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'sightear-melody.json'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { status.textContent = error instanceof Error ? error.message : '无法导出'; }
  }, { signal });
  find<HTMLInputElement>('.composer-import').addEventListener('change', (event) => {
    void (async () => {
      try {
        const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
        if (file.size > 256000) throw new Error('乐谱文件过大');
        const imported = JSON.parse(await file.text()) as ComposerDraft & { version: string };
        if (signal.aborted) return;
        if (imported.version !== 'sightear-score-1') throw new Error('不支持的乐谱格式');
        customPilotCase(imported.score, imported.tempoBpm);
        if (imported.score.measures.some((measure) => measure.time.beats !== 4 || measure.time.unit !== 4
          || measure.voices[0]!.notes.some((note) => note.duration.tuplet || note.duration.dots > 1
            || (note.pitch && (note.pitch.midi < 36 || note.pitch.midi > 84))))) throw new Error('编辑器支持 4/4、C2–C6、单附点和普通时值');
        tempo.value = String(imported.tempoBpm); mount(imported.score); status.textContent = '乐谱已导入';
      } catch { if (!signal.aborted) status.textContent = '无法导入：请使用本编辑器导出的有效乐谱，当前草稿已保留'; }
    })();
  }, { signal });
  signal.addEventListener('abort', stopPreview, { once: true });
}
