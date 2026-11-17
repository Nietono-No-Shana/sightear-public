import type { PitchFrame, Response } from '../engine/ports';
import { expandRepeatedTargets } from '@engine/scoring';
import type { NextItem } from '../engine/selection';
import type { PilotStore } from '../store/pilot';
import { pitchName } from '../store/pilot';
import { WebAudioOut } from '../adapters/audio';
import { PilotMicrophone } from '../adapters/microphone';
import type { PilotMetronome } from './pilot-metronome';
import { recordingUrl } from '../adapters/recording';
import { mountPitchTrace } from './pilot-pitch';

export function mountPilotCapture(container: HTMLElement, item: NextItem, store: PilotStore, audio: WebAudioOut,
  signal: AbortSignal, changed: (response: Response | null) => void, busy: (value: boolean) => void, metronome: PilotMetronome, scoreSurface: HTMLElement) {
  const key = item.key;
  if (key.type !== 'performance' || key.mode === 'notation') throw new Error('invalid capture type');
  const sung = key.mode === 'sung';
  container.innerHTML = `<div class="row"><button class="button pilot-record">${sung ? '开始演唱' : '开始敲击'}</button>
    <button class="button pilot-stop" disabled>结束录入</button>
    <label>输入延迟补偿 <input class="pilot-latency" aria-label="输入延迟补偿" type="number" min="-1000" max="1000" value="0" step="10"> ms</label></div>
    <p class="pilot-capture-status" role="status">预备拍后开始${sung ? '演唱；建议戴耳机' : '敲击；使用空格或下方按钮'}。</p>
    <p class="pilot-live-pitch" ${sung ? '' : 'hidden'}></p>
    <div class="pilot-recording" hidden><span>本次录音 · 仅临时回放</span><audio class="pilot-recording-audio" controls controlslist="nodownload" preload="metadata" aria-label="本次录音回放"></audio></div>
    <button class="button pilot-tap" ${sung ? 'hidden' : ''} disabled>敲击 / Space</button>`;
  const start = container.querySelector<HTMLButtonElement>('.pilot-record')!;
  const stop = container.querySelector<HTMLButtonElement>('.pilot-stop')!;
  const tap = container.querySelector<HTMLButtonElement>('.pilot-tap')!;
  const latency = container.querySelector<HTMLInputElement>('.pilot-latency')!;
  const status = container.querySelector<HTMLElement>('.pilot-capture-status')!;
  const microphone = new PilotMicrophone();
  const duration = key.timing === 'none' ? 4000 : key.end + 450;
  const trace = sung ? mountPitchTrace(scoreSurface, container.querySelector<HTMLElement>('.pilot-live-pitch')!, duration, key.tempoBpm) : null;
  const recording = container.querySelector<HTMLAudioElement>('.pilot-recording-audio')!;
  const recordingPanel = container.querySelector<HTMLElement>('.pilot-recording')!;
  let recordingSource: string | null = null;
  let animation = 0;
  const pauseReplay = (): void => { recording.pause(); cancelAnimationFrame(animation); };
  const releaseRecording = (): void => {
    pauseReplay(); recording.removeAttribute('src'); recording.load(); recordingPanel.hidden = true;
    if (recordingSource) URL.revokeObjectURL(recordingSource);
    recordingSource = null;
  };
  const animateReplay = (): void => {
    trace?.seek(recording.currentTime * 1000 - adjustment);
    if (!recording.paused) animation = requestAnimationFrame(animateReplay);
  };
  recording.addEventListener('play', () => { audio.stop(); metronome.stop(); animateReplay(); }, { signal });
  recording.addEventListener('pause', () => cancelAnimationFrame(animation), { signal });
  recording.addEventListener('seeked', () => trace?.seek(recording.currentTime * 1000 - adjustment), { signal });
  recording.addEventListener('error', () => { if (recordingSource) status.textContent = '本次录音暂时无法播放，请重新录入。'; }, { signal });
  let running = false;
  let origin = 0;
  let timer = 0;
  let frames: PitchFrame[] = [];
  let onsets: number[] = [];
  let adjustment = 0;
  const cleanup = (): void => {
    running = false;
    window.clearInterval(timer);
    microphone.stop();
    audio.stop();
    metronome.stop();
    pauseReplay();
  };
  signal.addEventListener('abort', () => { cleanup(); releaseRecording(); }, { once: true });
  const finish = (error?: string): void => {
    const captured = sung && !error ? microphone.takeRecording() : null;
    cleanup();
    if (captured) { recordingSource = recordingUrl(captured); recording.src = recordingSource; recordingPanel.hidden = false; }
    busy(false);
    start.disabled = false;
    latency.disabled = false;
    stop.disabled = true;
    tap.disabled = true;
    start.textContent = '重新录入';
    if (error) { status.textContent = error; changed(null); return; }
    const notes = store.segment(frames).map((note) => ({ ...note, start: note.start - adjustment }));
    if (sung ? !notes.length : !onsets.length) {
      status.textContent = '没有有效输入，请重新录入。'; changed(null); return;
    }
    const displayNotes = sung ? expandRepeatedTargets(key, notes).notes : notes;
    changed(sung ? { kind: 'sung', notes, rtMs: 0 } : { kind: 'tapped', onsets: onsets.map((time) => time - adjustment), rtMs: 0 });
    status.textContent = sung ? `识别 ${displayNotes.length} 个音：${displayNotes.map((note) => `${pitchName(note.midi)} (${Math.round(note.cents)}¢)`).join(' · ')}`
      : `${onsets.length} 次敲击：${onsets.map((time) => `${Math.round(time - adjustment)} ms`).join(' · ')}`;
  };
  start.addEventListener('click', async () => {
    adjustment = Number(latency.value);
    if (!Number.isFinite(adjustment) || Math.abs(adjustment) > 1000) { status.textContent = '补偿范围为 −1000 到 1000 ms'; return; }
    changed(null);
    busy(true);
    start.disabled = true;
    latency.disabled = true;
    frames = []; onsets = [];
    releaseRecording(); trace?.reset();
    status.textContent = sung ? '等待麦克风…' : '准备…';
    origin = 0;
    try {
      audio.stop();
      await metronome.prepare(async () => {
        if (sung) await microphone.open();
      });
      if (signal.aborted) { microphone.stop(); return; }
      const lead = item.presented.inputLeadInMs ?? 0;
      origin = performance.now() + 100 + lead;
      running = true;
      stop.disabled = false;
      if (sung) microphone.listen(origin, (samples, rate, time) => {
        const frame = store.analyze(samples, rate, time);
        frames.push(frame);
        trace?.append({ ...frame, t: frame.t - adjustment });
      }, () => finish('麦克风中断，请重新录入。'), duration);
      metronome.follow(origin, lead, duration);
      timer = window.setInterval(() => {
        const elapsed = performance.now() - origin;
        trace?.seek(elapsed - adjustment);
        tap.disabled = elapsed < 0;
        status.textContent = elapsed < 0 ? `预备 ${Math.ceil(-elapsed / (60000 / key.tempoBpm))}`
          : sung ? '正在录入演唱…' : `正在录入：${onsets.length} 次敲击`;
        if (elapsed >= duration) finish();
      }, 40);
    } catch (error) {
      if (!signal.aborted) finish(error instanceof Error ? error.message : '录入失败');
    }
  }, { signal });
  const recordTap = (): void => {
    const elapsed = performance.now() - origin;
    if (running && elapsed >= 0 && !sung) onsets.push(elapsed);
  };
  tap.addEventListener('pointerdown', (event) => { event.preventDefault(); recordTap(); }, { signal });
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || sung || !running || event.repeat || (event.target instanceof Element && event.target.matches('input,select,textarea'))) return;
    event.preventDefault(); recordTap();
  }, { signal });
  stop.addEventListener('click', () => finish(), { signal });
  return { disable: () => { cleanup(); container.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach((control) => { control.disabled = true; }); } };
}
