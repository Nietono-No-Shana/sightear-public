import type { PresentedItem, SoundEvent } from '../engine/ports';
import { WebAudioOut } from '../adapters/audio';

export function mountPilotMetronome(container: HTMLElement, item: PresentedItem, signal: AbortSignal, beforeStart: () => void) {
  const time = item.notationContext?.time ?? { beats: 4, unit: 4 };
  const beatMs = 60000 / item.features.tempoBpm * 4 / time.unit;
  container.innerHTML = `<div class="row pilot-metronome"><span>♩ = ${item.features.tempoBpm} · ${time.beats}/${time.unit}</span>
    <button type="button" class="button pilot-metronome-toggle" aria-pressed="false">开启节拍器</button>
    <label><input type="checkbox" class="pilot-metronome-sound" checked>作答时有声</label>
    <div class="pilot-beats" aria-label="拍点"></div><span class="muted pilot-beat-status" role="status">已停止</span></div>`;
  const toggle = container.querySelector<HTMLButtonElement>('.pilot-metronome-toggle')!;
  const sound = container.querySelector<HTMLInputElement>('.pilot-metronome-sound')!;
  const beats = container.querySelector<HTMLElement>('.pilot-beats')!;
  const status = container.querySelector<HTMLElement>('.pilot-beat-status')!;
  const dots = Array.from({ length: time.beats }, (_, index) => {
    const dot = document.createElement('span'); dot.textContent = String(index + 1); beats.append(dot); return dot;
  });
  const audio = new WebAudioOut();
  let timer = 0;
  let generation = 0;
  let origin = 0;
  let end = Infinity;
  let scheduled = 0;
  let leadBeats = 0;
  let audioOrigin = 0;
  let recording = false;
  const stop = (): void => {
    generation += 1;
    window.clearInterval(timer); timer = 0; audio.stop(); recording = false;
    toggle.disabled = false; toggle.textContent = '开启节拍器'; toggle.setAttribute('aria-pressed', 'false');
    dots.forEach((dot) => dot.removeAttribute('aria-current')); status.textContent = '已停止';
  };
  const scheduleRecording = (): void => {
    const first = Math.max(0, Math.ceil((audio.now() - audioOrigin) / beatMs));
    const events: SoundEvent[] = [];
    for (let index = first; origin + index * beatMs < end; index += 1) {
      if (index < leadBeats || sound.checked) events.push({ kind: 'click', start: (index - first) * beatMs, accent: index % time.beats === 0 });
    }
    audio.schedule(events, audioOrigin + first * beatMs);
  };
  const tick = (): void => {
    const now = performance.now();
    if (now >= end) { stop(); return; }
    if (!recording) {
      scheduled = Math.max(scheduled, Math.ceil((audio.now() - audioOrigin) / beatMs));
      while (audioOrigin + scheduled * beatMs < audio.now() + 1000) {
        audio.schedule([{ kind: 'click', start: 0, accent: scheduled % time.beats === 0 }], audioOrigin + scheduled * beatMs);
        scheduled += 1;
      }
    }
    const current = Math.floor((now - origin) / beatMs);
    dots.forEach((dot, index) => {
      if (current >= 0 && current % time.beats === index) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    status.textContent = current < 0 ? '准备' : current < leadBeats ? '预备拍' : recording ? `作答中 · ${sound.checked ? '有声' : '静音'}` : '练拍中';
  };
  const run = (start: number, until: number, lead: number): void => {
    origin = start; end = until; leadBeats = Math.round(lead / beatMs); scheduled = 0;
    audioOrigin = audio.now() + start - performance.now();
    if (recording) scheduleRecording();
    toggle.setAttribute('aria-pressed', 'true'); toggle.textContent = recording ? '随录入同步' : '停止节拍器';
    tick(); timer = window.setInterval(tick, 25);
  };
  toggle.addEventListener('click', async () => {
    if (timer) { stop(); return; }
    beforeStart();
    const request = ++generation;
    toggle.disabled = true;
    try {
      await audio.resume();
      if (signal.aborted || generation !== request) return;
      toggle.disabled = false;
      run(performance.now() + 100, Infinity, 0);
    } catch { if (!signal.aborted && generation === request) { stop(); status.textContent = '节拍器音频不可用'; } }
  }, { signal });
  sound.addEventListener('change', () => {
    if (!timer || !recording) return;
    audio.stop();
    scheduleRecording();
    tick();
  }, { signal });
  signal.addEventListener('abort', () => { stop(); audio.dispose(); }, { once: true });
  return {
    stop,
    async prepare(beforeOutput?: () => Promise<void>): Promise<void> {
      stop(); recording = true; toggle.disabled = true; status.textContent = '准备录入';
      audio.dispose();
      await beforeOutput?.();
      if (signal.aborted) return;
      await audio.resume();
    },
    follow(inputOrigin: number, lead: number, duration: number): void {
      if (signal.aborted) return;
      run(inputOrigin - lead, inputOrigin + duration, lead);
    },
  };
}

export type PilotMetronome = ReturnType<typeof mountPilotMetronome>;
