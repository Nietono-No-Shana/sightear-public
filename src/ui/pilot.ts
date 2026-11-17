import type { Response, SoundEvent, Storage, TimbreId, VocalBounds } from '../engine/ports';
import { midiToName } from '../engine/theory';
import type { NextItem } from '../engine/selection';
import { getSkill, VOCAL_RANGES, type VocalRangeId } from '../engine/config';
import { createClock } from '../adapters/clock';
import { createRngFactory } from '../adapters/rng';
import { WebAudioOut } from '../adapters/audio';
import { LocalStorageAttempts } from '../adapters/storage';
import { createPilotStore, contentPilotCases, pilotLabels, pilotReference, scoreView, type PilotCase } from '../store/pilot';
import { renderPilotScore } from './pilot-score';
import { mountPilotEditor } from './pilot-editor';
import { mountPilotComposer, type ComposerDraft } from './pilot-composer';
import { mountPilotCapture } from './pilot-capture';
import { mountPilotMetronome } from './pilot-metronome';
import { clefFor, renderStaff } from './staff';
import './pilot.css';

export interface CoursePractice {
  example: PilotCase;
  storage: Storage;
  nextSeed: () => number;
}

export async function mountPilot(root: HTMLElement, timbre: TimbreId, exit: () => void, vocalRange: VocalRangeId = 'original', vocalBounds?: VocalBounds, course?: CoursePractice): Promise<void> {
  const store = await createPilotStore(course?.storage ?? new LocalStorageAttempts('sightear.pilot.attempts.v1'), createClock(), createRngFactory(), timbre, vocalRange, vocalBounds, course ? 'course' : 'pilot');
  const bounds = vocalBounds ?? VOCAL_RANGES.find((voice) => voice.id === vocalRange)!;
  const audio = new WebAudioOut();
  void audio.prime(timbre);
  let draft: ComposerDraft | null = null;
  let imported: readonly PilotCase[] = [];
  let page = new AbortController();
  const clear = (): void => { page.abort(); audio.stop(); page = new AbortController(); };
  const close = (): void => { clear(); audio.dispose(); window.removeEventListener('pagehide', close); exit(); };
  window.addEventListener('pagehide', close, { once: true });
  const element = <T extends Element>(selector: string): T => root.querySelector<T>(selector)!;
  const button = (label: string, action: () => void): HTMLButtonElement => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'button'; node.textContent = label;
    node.addEventListener('click', action, { signal: page.signal }); return node;
  };
  const play = async (events: readonly SoundEvent[], status: HTMLElement): Promise<void> => {
    root.querySelectorAll('audio').forEach((player) => player.pause());
    const signal = page.signal;
    try { await audio.resume(); if (!signal.aborted) { audio.stop(); audio.schedule(events, audio.now()); } }
    catch { if (!signal.aborted) status.textContent = '音频无法播放，请检查浏览器设置。'; }
  };
  const list = (): void => {
    clear();
    root.innerHTML = `<section class="panel pilot"><div class="row"><h2>题型试练</h2><div class="pilot-actions"></div></div>
      <p class="muted">14 类 · 每类 2 题 · 固定材料，可重复核对 · 试练记录单独保存</p>
      <p class="muted">演唱音区：${VOCAL_RANGES.find((voice) => voice.id === vocalRange)!.label}${vocalRange === 'original' ? '' : ` · ${midiToName(bounds.low)}–${midiToName(bounds.high)}`} · 可在首页设置中更改</p><div class="pilot-grid"></div></section>`;
    element('.pilot-actions').append(button('返回首页', close), button('简易音符编辑器', () => {
      clear(); mountPilotComposer(root, audio, timbre, page.signal, draft, (value) => { draft = value; },
        (example) => show(example, store.startCase(example)), list);
    }), button('导出试练记录', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(store.history(), null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'sightear-pilot-attempts.json'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    for (const example of store.cases) {
      const entry = button('', () => show(example, store.start(example.id)));
      const title = document.createElement('strong'); title.textContent = example.title;
      const material = document.createElement('span'); material.textContent = example.material;
      entry.append(title, material); element('.pilot-grid').append(entry);
    }
    const upload = document.createElement('input');
    upload.type = 'file'; upload.accept = '.json,application/json'; upload.setAttribute('aria-label', '导入课程内容包（仅预览）');
    const seedInput = document.createElement('input'); seedInput.type = 'number'; seedInput.value = '42';
    seedInput.min = '0'; seedInput.max = '4294967295'; seedInput.step = '1'; seedInput.setAttribute('aria-label', '内容包试练种子');
    const message = document.createElement('p'); message.textContent = '导入内容包仅用于试练，不会发布到正式课程；种子相同可复现。';
    const signal = page.signal;
    upload.addEventListener('change', async () => {
      try {
        const file = upload.files?.[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) throw new RangeError('单个内容包最多 4 MiB，请按模块拆分');
        const value: unknown = JSON.parse(await file.text());
        if (signal.aborted) return;
        imported = contentPilotCases(value, Number(seedInput.value));
        list();
      } catch (error) { if (!signal.aborted) message.textContent = error instanceof Error ? error.message : '导入失败'; }
    }, { signal });
    element('.panel').append(message, upload, seedInput);
    for (const example of imported) {
      const entry = button(`试练：${example.title} · ${example.source}`, () => {
        try { show(example, store.startCase(example)); }
        catch (error) { message.textContent = error instanceof Error ? error.message : '生成失败'; }
      });
      element('.panel').append(entry);
    }
  };
  const show = (example: PilotCase, item: NextItem): void => {
    clear();
    const questionCount = example.lesson.exerciseSpec?.questionCount ?? example.lesson.practiceSpec?.questionCount ?? 2;
    const started = performance.now();
    let answered = false;
    let saving = false;
    let response: Response | null = null;
    let disableInput = (): void => {};
    root.innerHTML = `<section class="panel pilot"><div class="row"><button class="button pilot-back">题型列表</button><h2 class="pilot-title"></h2><span class="pilot-progress"></span></div>
      <p class="pilot-prompt"></p><div class="row"><button class="button pilot-play">播放 / 重听</button></div>
      <div class="pilot-metronome-host"></div><div class="pilot-given"></div><div class="pilot-input"></div><button class="button primary pilot-submit" disabled>提交</button>
      <p class="pilot-status" role="status"></p><div class="pilot-feedback"></div></section>`;
    element('.pilot-title').textContent = example.title;
    element('.pilot-progress').textContent = `${store.result().completed + 1} / ${questionCount}`;
    element('.pilot-prompt').textContent = item.presented.prompt;
    const back = element<HTMLButtonElement>('.pilot-back');
    const replay = element<HTMLButtonElement>('.pilot-play');
    const submit = element<HTMLButtonElement>('.pilot-submit');
    const status = element<HTMLElement>('.pilot-status');
    const input = element<HTMLElement>('.pilot-input');
    const given = element<HTMLElement>('.pilot-given');
    const metronome = mountPilotMetronome(element<HTMLElement>('.pilot-metronome-host'), item.presented, page.signal, () => {
      audio.stop(); root.querySelectorAll('audio').forEach((player) => player.pause());
    });
    back.textContent = course ? '返回课程' : '题型列表';
    back.onclick = course ? close : list;
    replay.hidden = !item.presented.stimulus?.length;
    if (item.presented.exerciseKind === 'interval-singing' || item.presented.exerciseKind === 'melody-singing') replay.textContent = '播放参考音';
    replay.onclick = () => { metronome.stop(); void play(item.presented.stimulus ?? [], status); };
    const setResponse = (value: Response | null): void => { response = value; submit.disabled = !value || answered || saving; };
    const key = item.key;
    const rhythmOnly = item.presented.exerciseKind?.startsWith('rhythm-') ?? false;
    const reference = pilotReference(item);
    if (vocalRange !== 'original' && key.type === 'performance' && key.mode === 'sung'
      && [...key.notes.map((note) => note.midi), ...(reference ? [reference.midi] : [])].some((midi) => midi < bounds.low || midi > bounds.high)) {
      element('.pilot-prompt').textContent += ' · 本题部分音超出所选舒适音区，可返回选择其他题型或调整范围';
    }
    const clef = item.presented.score?.clef ?? item.answerScore?.clef ?? clefFor([...item.answerPitches, ...(reference ? [reference] : [])]);
    if (item.presented.score) renderPilotScore(given, scoreView(item.presented.score), rhythmOnly);
    else if (!(key.type === 'performance' && key.mode === 'notation')) {
      renderStaff(given, reference ? [reference] : [], { clef });
    }
    if (key.type === 'choice') {
      input.classList.add('pilot-options');
      item.presented.options?.forEach((option, index) => {
        const choice = button(pilotLabels[option] ?? option, () => {
          input.querySelectorAll('button').forEach((node) => node.setAttribute('aria-pressed', 'false'));
          choice.setAttribute('aria-pressed', 'true'); setResponse({ kind: 'choice', index, rtMs: 0 });
        });
        choice.setAttribute('aria-pressed', 'false'); input.append(choice);
      });
    } else if (key.type === 'functions') {
      const selects = Array.from({ length: key.symbols.length }, (_, index) => {
        const select = document.createElement('select'); select.setAttribute('aria-label', `第 ${index + 1} 个和弦功能`);
        select.add(new Option('选择功能', '')); item.presented.options?.forEach((option) => select.add(new Option(option, option)));
        input.append(select); return select;
      });
      selects.forEach((select) => { select.onchange = () => setResponse(selects.every((node) => node.value) ? { kind: 'functions', symbols: selects.map((node) => node.value), rtMs: 0 } : null); });
    } else if (key.type === 'locations' && item.presented.score) {
      const selected = new Set<number>();
      const draw = (): void => renderPilotScore(given, scoreView(item.presented.score!), true, (index) => {
        if (answered || saving) return;
        if (selected.has(index)) selected.delete(index); else selected.add(index);
        draw(); setResponse(selected.size ? { kind: 'locations', indices: [...selected].sort((first, second) => first - second), rtMs: 0 } : null);
      }, [...selected]);
      draw();
    } else if (key.type === 'performance' && key.mode === 'notation') {
      const context = item.presented.notationContext!;
      const editor = mountPilotEditor(input, context, key.rhythmOnly, (valid) => { submit.disabled = !valid || answered || saving; });
      disableInput = editor.disable;
      submit.onclick = () => { setResponse({ kind: 'notation', score: editor.score(), rtMs: 0 }); void save(); };
    } else if (key.type === 'performance') {
      const capture = mountPilotCapture(input, item, store, audio, page.signal, setResponse, (value) => { replay.disabled = value; }, metronome, given);
      disableInput = capture.disable;
    }
    const feedback = (judgement: Awaited<ReturnType<typeof store.commit>>): void => {
      const output = element<HTMLElement>('.pilot-feedback');
      const result = document.createElement('h3'); result.textContent = key.type === 'performance'
        ? `得分 ${Math.round(judgement.partial * 100)} / 100${judgement.correct ? ' · 全部达标' : ''}`
        : judgement.correct ? '正确' : `未通过 · ${Math.round(judgement.partial * 100)}%`;
      const answer = document.createElement('p'); answer.textContent = `答案：${store.answerName(item)}`; output.append(result, answer);
      const repaired = judgement.details?.filter((detail) => (detail.responseIndices?.length ?? 0) > 1).length ?? 0;
      if (repaired) {
        const notice = document.createElement('p'); notice.textContent = `已容错处理 ${repaired} 处短暂断音或起音片段。`; output.append(notice);
      }
      if (key.type === 'performance') {
        const breakdown = document.createElement('p'); breakdown.className = 'pilot-score-breakdown';
        breakdown.textContent = [judgement.pitchScore === undefined ? '' : `音准 ${Math.round(judgement.pitchScore * 100)} 分`,
          judgement.rhythmScore === undefined ? '' : `节奏 ${Math.round(judgement.rhythmScore * 100)} 分`].filter(Boolean).join(' · ');
        output.append(breakdown);
      }
      if (item.answerScore) { const score = document.createElement('div'); output.append(score); renderPilotScore(score, scoreView(item.answerScore), rhythmOnly); }
      else if (item.answerPitches.length) {
        const score = document.createElement('div'); output.append(score);
        if (getSkill(item.presented.skill).kind === 'interval-comparison') {
          for (const [index, label] of ['A', 'B'].entries()) {
            const heading = document.createElement('p'); heading.textContent = label;
            const staff = document.createElement('div'); score.append(heading, staff);
            renderStaff(staff, item.answerPitches.slice(index * 2, index * 2 + 2), { clef, layout: 'sequence' });
          }
        } else if (key.type === 'functions') {
          let offset = 0;
          const groups = (item.presented.stimulus ?? []).filter((event) => event.kind === 'chord').map((event) => {
            const pitches = item.answerPitches.slice(offset, offset + event.midis.length); offset += event.midis.length; return pitches;
          });
          renderStaff(score, item.answerPitches, { clef, groups });
        } else renderStaff(score, item.answerPitches, { clef, layout: ['chord', 'chord-inversion'].includes(getSkill(item.presented.skill).kind) ? 'chord' : 'sequence' });
      }
      if (key.type === 'performance') output.append(button('播放答案', () => { metronome.stop(); void play(key.notes.map((note) => ({ kind: 'note', midi: note.midi, start: note.start, dur: note.dur, velocity: 0.7, timbre })), status); }));
      if (judgement.details?.length) {
        const table = document.createElement('table'); table.className = 'pilot-details';
        const header = table.insertRow(); ['目标音', '音准偏差 ¢', '起音偏差 ms', '时长偏差 ms', '音准分', '节奏分', '结果'].forEach((text) => { const cell = document.createElement('th'); cell.textContent = text; header.append(cell); });
        const errors: Record<string, string> = { pitch: '音高', rhythm: '节奏', omission: '漏音', extra: '多音' };
        for (const detail of judgement.details) {
          const row = table.insertRow(); [detail.expectedIndex === null ? '—' : String(detail.expectedIndex + 1), ...[detail.cents, detail.onsetErrorMs, detail.durationErrorMs].map((value) => value === null ? '—' : String(Math.round(value))),
            ...[detail.pitchScore, detail.rhythmScore].map((value) => value === undefined ? '—' : String(Math.round(value * 100))),
            detail.errors.map((error) => errors[error] ?? error).join('、') || '达标'].forEach((text) => { row.insertCell().textContent = text; });
        }
        output.append(table);
      }
      output.append(button(store.result().completed < questionCount ? '下一题' : '完成', () => {
        try {
        const next = store.next();
        if (next) show(example, next); else {
          clear(); const result = store.result(); root.innerHTML = '<section class="panel pilot"><h2>试练完成</h2><p class="pilot-result"></p><div class="pilot-actions"></div></section>';
          element('.pilot-result').textContent = `${example.title}：平均 ${Math.round(result.averageScore * 100)} 分 · ${result.correct} / ${result.completed} 题全部达标`;
          if (course) element('h2').textContent = '本组完成';
          element('.pilot-actions').append(button('重复这组题', () => show(example, store.startCase(example))), button(course ? '返回课程' : '题型列表', course ? close : list));
          if (course) element('.pilot-actions').prepend(button('再练一组', () => {
            try { const fresh = { ...example, seed: course.nextSeed() }; show(fresh, store.startCase(fresh)); }
            catch (error) { element('.pilot-result').textContent = error instanceof Error ? error.message : '生成失败'; }
          }));
        }
        } catch (error) { status.textContent = error instanceof Error ? error.message : '生成失败，请返回课程重试'; }
      }));
    };
    const save = async (): Promise<void> => {
      if (!response || answered || saving) return;
      saving = true; back.disabled = true; submit.disabled = true; audio.stop(); metronome.stop();
      try {
        const judgement = await store.commit({ ...response, rtMs: performance.now() - started });
        answered = true; disableInput(); input.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach((node) => { node.disabled = true; });
        status.textContent = course ? '已保存到练习记录' : '已保存到试练记录'; feedback(judgement);
      } catch (error) { status.textContent = error instanceof Error ? error.message : '保存失败，请重试'; submit.disabled = false; }
      finally { saving = false; back.disabled = false; }
    };
    if (!submit.onclick) submit.onclick = () => { void save(); };
  };
  try { if (course) show(course.example, store.startCase(course.example)); else list(); }
  catch (error) { clear(); audio.dispose(); window.removeEventListener('pagehide', close); throw error; }
}
