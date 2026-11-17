import { WebAudioOut } from '../adapters/audio';
import { createRng } from '../adapters/rng';
import { LocalSettings, type AppSettings } from '../adapters/settings';
import { LocalStorageAttempts } from '../adapters/storage';
import { midiToName } from '../engine/theory';
import { VOCAL_RANGES } from '@engine/config';
import type { Attempt, TimbreId, VocalRangeId } from '@engine/ports';

const TIMBRE_LABELS: Readonly<Record<TimbreId, string>> = {
  piano: '钢琴（采样）',
  strings: '弦乐',
  synth: '合成器',
  organ: '管风琴',
};

const TIMBRES: readonly TimbreId[] = ['piano', 'strings', 'synth', 'organ'];

export async function mountApp(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="app">
      <header class="app-header">
        <div class="brand">
          <h1>sightear</h1>
          <span class="brand-sub">视唱练耳</span>
        </div>
        <div class="header-actions">
          <button class="button js-pilot" type="button">题型试练</button>
          <button class="button js-settings" type="button">设置</button>
          <button class="button js-reset" type="button">重置</button>
        </div>
      </header>

      <div class="js-view"></div>
    </div>
  `;

  const query = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (element === null) throw new Error(`missing element ${selector}`);
    return element;
  };

  const view = query<HTMLElement>('.js-view');
  const settingsButton = query<HTMLButtonElement>('.js-settings');
  const resetButton = query<HTMLButtonElement>('.js-reset');
  const pilotButton = query<HTMLButtonElement>('.js-pilot');

  const audio = new WebAudioOut();
  const storage = new LocalStorageAttempts();
  const settingsStore = new LocalSettings();
  const rng = createRng(Date.now() >>> 0);
  let settings: AppSettings = settingsStore.load();
  void audio.prime(settings.timbre);
  let attempts: readonly Attempt[] = await storage.loadAll();

  const setHeaderDisabled = (disabled: boolean): void => {
    pilotButton.disabled = disabled;
    settingsButton.disabled = disabled;
    resetButton.disabled = disabled;
  };

  const preloadCourseLibrary = (): void => {
    void Promise.all([import('./course-library'), import('./course-content')]).catch(() => {});
  };

  const whenIdle = (task: () => void): void => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(task, { timeout: 2000 });
    } else {
      window.setTimeout(task, 900);
    }
  };

  const renderHome = (): void => {
    setHeaderDisabled(false);
    const practiceCount = attempts.length;
    view.innerHTML = `
      <section class="panel">
        <div class="home-hero">
          <div class="home-copy">
            <p class="course-eyebrow">日常练习</p>
            <h2 class="home-title">今天练什么</h2>
            <p class="home-lead">按题型进入已编写好的课程。练习记录保存在本机，缺失内容的课程与模块已隐藏。</p>
          </div>
        </div>
        <button class="home-card js-courses" type="button">
          <span class="home-card-icon" aria-hidden="true">♪</span>
          <span class="home-card-body">
            <span class="home-card-title">课程库</span>
            <span class="home-card-sub">和弦、音程、节奏、旋律与视唱</span>
          </span>
          <span class="home-card-arrow" aria-hidden="true">→</span>
        </button>
        <p class="muted" style="margin: 18px 0 0">
          默认音源：${TIMBRE_LABELS[settings.timbre]} · 练习记录：${practiceCount === 0 ? '尚无' : `${practiceCount} 次`}
        </p>
      </section>
    `;
    view.querySelector('.js-courses')?.addEventListener('click', () => {
      void openCourseLibrary();
    });
  };

  const renderSettings = (): void => {
    setHeaderDisabled(false);
    const bounds = settings.vocalBounds ?? VOCAL_RANGES.find((voice) => voice.id === settings.vocalRange)!;
    const noteOptions = (selected: number): string => Array.from({ length: 128 }, (_, midi) => `<option value="${midi}" ${midi === selected ? 'selected' : ''}>${midiToName(midi)}</option>`).join('');
    view.innerHTML = `
      <section class="panel settings-card">
        <div class="course-topbar">
          <button class="button ghost js-home" type="button">← 首页</button>
        </div>
        <h2 class="section-title">设置</h2>

        <section class="settings-section">
          <h3 class="settings-heading">演唱音区</h3>
          <p class="muted">声部只用于提供初始范围；可按自己轻松、稳定唱出的音调整。新开始的视唱与模唱会整体移八度，谱号、参考音和判分同步调整。</p>
          <label class="settings-label">
            <span class="muted">声部预设</span>
            <select class="js-vocal-range" aria-label="演唱音区">
              ${VOCAL_RANGES.map((voice) => `<option value="${voice.id}" ${settings.vocalRange === voice.id ? 'selected' : ''}>${voice.label}</option>`).join('')}
            </select>
          </label>
          <div class="row" style="margin-top: 12px" ${settings.vocalRange === 'original' ? 'hidden' : ''}>
            <label class="settings-label">
              <span class="muted">舒适最低音</span>
              <select class="js-vocal-low" aria-label="舒适最低音">${noteOptions(bounds.low)}</select>
            </label>
            <button class="button small js-preview-low" type="button">试听最低音</button>
            <label class="settings-label">
              <span class="muted">舒适最高音</span>
              <select class="js-vocal-high" aria-label="舒适最高音">${noteOptions(bounds.high)}</select>
            </label>
            <button class="button small js-preview-high" type="button">试听最高音</button>
          </div>
          <p class="muted js-vocal-status" role="status">${settings.vocalRange === 'original' ? '原音区：不限制' : `当前范围：${midiToName(bounds.low)}–${midiToName(bounds.high)}`}</p>
        </section>

        <section class="settings-section">
          <h3 class="settings-heading">默认音源</h3>
          <p class="muted">只影响新开始的练习；已记录的 Attempt 不会被改写。</p>
          <div class="timbre-grid">
            ${TIMBRES.map(
              (timbre) => `
              <button class="button timbre-option${settings.timbre === timbre ? ' selected' : ''}" type="button" data-timbre="${timbre}">
                ${TIMBRE_LABELS[timbre]}
              </button>
            `,
            ).join('')}
          </div>
          <div class="row" style="margin-top: 16px">
            <button class="button primary js-preview-timbre" type="button">试听当前音源</button>
            <span class="muted">当前：${TIMBRE_LABELS[settings.timbre]}</span>
          </div>
          <p class="muted" style="margin: 12px 0 0">钢琴采样：<a href="https://archive.org/details/SalamanderGrandPianoV3" target="_blank" rel="noreferrer">Salamander Grand Piano</a>（Yamaha C5）· Alexander Holm · CC BY 3.0</p>
        </section>
      </section>
    `;

    view.querySelector<HTMLSelectElement>('.js-vocal-range')!.addEventListener('change', (event) => {
      settings = { timbre: settings.timbre, vocalRange: (event.target as HTMLSelectElement).value as VocalRangeId };
      settingsStore.save(settings);
      renderSettings();
    });
    for (const side of ['low', 'high'] as const) {
      view.querySelector(`.js-vocal-${side}`)!.addEventListener('change', () => {
        const low = Number(view.querySelector<HTMLSelectElement>('.js-vocal-low')!.value);
        const high = Number(view.querySelector<HTMLSelectElement>('.js-vocal-high')!.value);
        const message = view.querySelector<HTMLElement>('.js-vocal-status')!;
        if (low >= high) {
          message.textContent = '最低音必须低于最高音；本次修改尚未保存。';
          return;
        }
        settings = { ...settings, vocalBounds: { low, high } };
        settingsStore.save(settings);
        message.textContent = `已保存舒适音区：${midiToName(low)}–${midiToName(high)}`;
      });
      view.querySelector(`.js-preview-${side}`)!.addEventListener('click', () => {
        const midi = Number(view.querySelector<HTMLSelectElement>(`.js-vocal-${side}`)!.value);
        void (async () => {
          audio.stop();
          await audio.resume();
          audio.schedule([{ kind: 'note', midi, start: 0, dur: 900, velocity: 0.7, timbre: settings.timbre }], audio.now());
        })();
      });
    }
    for (const button of view.querySelectorAll<HTMLButtonElement>('.timbre-option')) {
      button.addEventListener('click', () => {
        const timbre = button.dataset.timbre as TimbreId;
        if (!TIMBRES.includes(timbre)) return;
        settings = { ...settings, timbre };
        settingsStore.save(settings);
        void audio.prime(timbre);
        renderSettings();
      });
    }
    view.querySelector('.js-preview-timbre')?.addEventListener('click', () => {
      void (async () => {
        try {
          await audio.resume();
          audio.schedule([{ kind: 'chord', midis: [60, 64, 67], start: 0, dur: 900, timbre: settings.timbre }], audio.now());
        } catch {
          view.querySelector<HTMLElement>('.js-vocal-status')!.textContent = '音频播放失败，请检查浏览器设置。';
        }
      })();
    });
    view.querySelector('.js-home')?.addEventListener('click', renderHome);
  };

  const openCourseLibrary = async (): Promise<void> => {
    setHeaderDisabled(true);
    audio.stop();
    view.innerHTML = `
      <section class="panel course-panel">
        <div class="course-loading">
          <span class="course-spinner" aria-hidden="true"></span>
          <p>正在加载课程库…</p>
        </div>
      </section>
    `;
    try {
      const { mountCourseLibrary } = await import('./course-library');
      await mountCourseLibrary(
        view,
        storage,
        settings.timbre,
        settings.vocalRange,
        settings.vocalBounds,
        () => rng.int(0x100000000),
        () => {
          void storage.loadAll().then((loaded) => {
            attempts = loaded;
            renderHome();
          });
        },
      );
    } catch {
      setHeaderDisabled(false);
      view.innerHTML = '<section class="panel"><p class="muted">课程库加载失败，请刷新页面重试。</p></section>';
    }
  };

  const reset = (): void => {
    if (!window.confirm('清空所有练习记录？')) return;
    storage.clear();
    attempts = [];
    renderHome();
  };

  resetButton.addEventListener('click', reset);
  settingsButton.addEventListener('click', renderSettings);

  const openPilot = async (): Promise<void> => {
    audio.stop();
    setHeaderDisabled(true);
    const leave = (): void => {
      setHeaderDisabled(false);
      history.replaceState(null, '', location.pathname + location.search);
      renderHome();
    };
    try {
      history.replaceState(null, '', '#pilot');
      const { mountPilot } = await import('./pilot');
      await mountPilot(view, settings.timbre, leave, settings.vocalRange, settings.vocalBounds);
    } catch {
      leave();
    }
  };
  pilotButton.addEventListener('click', () => { void openPilot(); });

  if (location.hash === '#pilot') {
    void openPilot();
  } else {
    renderHome();
    whenIdle(preloadCourseLibrary);
  }
}
