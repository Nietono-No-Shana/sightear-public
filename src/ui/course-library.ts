import type { Direction, Storage, TimbreId, VocalBounds } from '../engine/ports';
import type { VocalRangeId } from '../engine/config';
import { inversionPlaybackCase } from '../store/course-library';
import type { CourseIndex, LessonIndex } from '../store/course-loading';
import { COURSE_GROUP_ORDER, COURSE_GROUP_TITLES } from '../store/course-localization';
import './course-library.css';

const DIRECTION_LABELS: Readonly<Record<Direction, string>> = {
  harmonic: '同时发声',
  asc: '上行琶音',
  desc: '下行琶音',
};

const DIRECTION_ORDER: readonly Direction[] = ['harmonic', 'asc', 'desc'];

export async function mountCourseLibrary(root: HTMLElement, storage: Storage, timbre: TimbreId, vocalRange: VocalRangeId, vocalBounds: VocalBounds | undefined, nextSeed: () => number, exit: () => void): Promise<void> {
  const { summaries, loadCourse, loadLesson } = await import('./course-content');
  let selected: CourseIndex | undefined;
  let generation = 0;
  let notice = '';
  let query = '';
  const opened = new Set<string>();
  let pilotPreloaded = false;

  const node = <Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className = '', text = ''): HTMLElementTagNameMap[Tag] => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const action = (label: string, className: string, handler: () => void): HTMLButtonElement => {
    const element = node('button', `button ${className}`.trim(), label);
    element.type = 'button';
    element.addEventListener('click', handler);
    return element;
  };
  const preloadPilot = (): void => {
    if (pilotPreloaded) return;
    pilotPreloaded = true;
    void import('./pilot').catch(() => { pilotPreloaded = false; });
  };
  const countLessons = (course: CourseIndex): number =>
    course.modules.reduce((sum, module) => sum + module.lessons.length, 0);

  const openCourse = async (id: string): Promise<void> => {
    const request = ++generation;
    showLoading('正在加载课程目录…');
    try {
      const course = await loadCourse(id);
      if (request !== generation) return;
      selected = course;
      notice = '';
      query = '';
      opened.clear();
      const first = course.modules[0];
      if (first) opened.add(first.id);
      render();
    } catch (error) {
      if (request !== generation) return;
      notice = `加载失败，请点击课程重试：${error instanceof Error ? error.message : '请重试'}`;
      render();
    }
  };

  const start = async (lesson: LessonIndex, module: CourseIndex['modules'][number], direction?: Direction): Promise<void> => {
    if (!lesson.content) return;
    const request = ++generation;
    showLoading('正在准备练习…', true);
    try {
      preloadPilot();
      const [loaded, pilot] = await Promise.all([loadLesson(lesson), import('./pilot')]);
      if (request !== generation) return;
      const example = direction ? inversionPlaybackCase(loaded, direction) : loaded;
      notice = '';
      const activeDirection = direction ?? lesson.content.direction;
      const directionLabel = lesson.content.inversion ? ` · ${DIRECTION_LABELS[activeDirection]}` : '';
      root.replaceChildren(node('p', 'loading-copy', '正在准备练习…'));
      await pilot.mountPilot(root, timbre, render, vocalRange, vocalBounds, {
        example: { ...example, title: `${module.title} · ${lesson.title}${directionLabel}`, seed: nextSeed() },
        storage,
        nextSeed,
      });
    } catch (error) {
      if (request !== generation) return;
      notice = `无法开始：${error instanceof Error ? error.message : '请重试'}`;
      render();
    }
  };

  const showLoading = (text: string, withBack = false): void => {
    root.replaceChildren();
    const panel = node('section', 'panel course-panel');
    root.append(panel);
    if (withBack) panel.append(action('← 返回课程', 'ghost', () => { generation += 1; render(); }));
    const loading = node('div', 'course-loading');
    loading.append(node('span', 'course-spinner'), node('p', '', text));
    panel.append(loading);
  };

  const renderLibrary = (): void => {
    root.replaceChildren();
    const panel = node('section', 'panel course-panel');
    root.append(panel);
    panel.append(action('← 首页', 'ghost course-home', exit));

    const totalLessons = summaries.reduce((sum, course) => sum + course.total, 0);
    const hero = node('div', 'course-hero');
    const copy = node('div', 'course-hero-copy');
    copy.append(
      node('p', 'course-eyebrow', '练习课程'),
      node('h2', 'course-title', '课程库'),
      node('p', 'course-subtitle', '只显示已编写内容的课程与课节；从任意课节直接开始。'),
    );
    const stats = node('div', 'course-hero-stats');
    for (const [value, label] of [[String(summaries.length), '门课程'], [String(totalLessons), '节可练习']] as const) {
      const stat = node('div', 'course-stat');
      stat.append(node('strong', '', value), node('span', '', label));
      stats.append(stat);
    }
    hero.append(copy, stats);
    panel.append(hero);

    if (notice) {
      const status = node('p', 'course-notice', notice);
      status.setAttribute('role', 'status');
      panel.append(status);
    }

    for (const group of COURSE_GROUP_ORDER) {
      const courses = summaries.filter((course) => course.group === group);
      if (courses.length === 0) continue;
      const section = node('section', 'course-group');
      section.append(node('h3', 'course-group-title', COURSE_GROUP_TITLES[group]));
      const grid = node('div', 'course-grid');
      for (const course of courses) {
        const card = action('', 'course-card', () => { void openCourse(course.id); });
        card.append(
          node('span', 'course-card-title', course.title),
          node('span', 'course-card-sub', course.subtitle),
          (() => {
            const foot = node('span', 'course-card-foot');
            foot.append(
              node('span', 'course-card-meta', `${course.total} 节 · ${course.moduleCount} 个模块`),
              node('span', 'course-card-arrow', '→'),
            );
            return foot;
          })(),
        );
        grid.append(card);
      }
      section.append(grid);
      panel.append(section);
    }
  };

  const renderCourse = (course: CourseIndex): void => {
    preloadPilot();
    root.replaceChildren();
    const panel = node('section', 'panel course-panel');
    root.append(panel);

    const topbar = node('div', 'course-topbar');
    topbar.append(
      action('← 全部课程', 'ghost', () => { generation += 1; selected = undefined; query = ''; render(); }),
      action('首页', 'ghost course-home', exit),
    );
    panel.append(topbar);

    const hero = node('div', 'course-hero course-hero-course');
    const copy = node('div', 'course-hero-copy');
    copy.append(
      node('p', 'course-eyebrow', COURSE_GROUP_TITLES[course.group]),
      node('h2', 'course-title', course.title),
      node('p', 'course-subtitle', course.subtitle),
    );
    const meta = node('div', 'course-meta');
    meta.append(
      node('span', 'course-pill', `${countLessons(course)} 节`),
      node('span', 'course-pill', `${course.modules.length} 个模块`),
    );
    copy.append(meta);
    hero.append(copy);
    panel.append(hero);

    if (notice) {
      const status = node('p', 'course-notice', notice);
      status.setAttribute('role', 'status');
      panel.append(status);
    }

    const toolbar = node('div', 'course-toolbar');
    const searchWrap = node('label', 'course-search');
    const searchIcon = node('span', 'course-search-icon', '⌕');
    searchIcon.setAttribute('aria-hidden', 'true');
    const search = node('input', 'course-search-input');
    search.type = 'search';
    search.placeholder = '搜索模块或课节';
    search.setAttribute('aria-label', '搜索模块或课节');
    search.value = query;
    searchWrap.append(searchIcon, search);
    const expand = action('展开全部', 'ghost small', () => {
      for (const module of course.modules) opened.add(module.id);
      drawModules();
    });
    const collapse = action('收起全部', 'ghost small', () => {
      opened.clear();
      drawModules();
    });
    toolbar.append(searchWrap, expand, collapse);
    panel.append(toolbar);

    const modules = node('div', 'module-list');
    panel.append(modules);

    const lessonCard = (module: CourseIndex['modules'][number], lesson: LessonIndex): HTMLElement => {
      const content = lesson.content;
      const row = node('div', 'course-lesson-row');
      const card = action('', 'course-lesson-card', () => { void start(lesson, module); });
      card.setAttribute('aria-label', `开始 ${module.title} ${lesson.title}`);
      card.title = lesson.originalTitle;
      const body = node('span', 'course-lesson-body');
      body.append(node('span', 'course-lesson-title', lesson.title));
      const metaText = content ? `${content.questions} 题${content.inversion ? ` · ${DIRECTION_LABELS[content.direction]}` : ''}${content.reference === 'tonic' ? ' · 含主音参考' : ''}` : '';
      body.append(node('span', 'course-lesson-meta', metaText));
      card.append(node('span', 'course-lesson-number', lesson.number), body, node('span', 'course-lesson-start', '开始'));
      row.append(card);
      if (content?.inversion) {
        const directions = node('div', 'course-directions');
        directions.setAttribute('role', 'group');
        directions.setAttribute('aria-label', `${lesson.title}播放方式`);
        for (const direction of DIRECTION_ORDER) {
          const chip = action(DIRECTION_LABELS[direction], `course-chip${direction === content.direction ? ' active' : ''}`, () => {
            void start(lesson, module, direction);
          });
          chip.setAttribute('aria-pressed', String(direction === content.direction));
          directions.append(chip);
        }
        row.append(directions);
      }
      return row;
    };

    const drawModules = (): void => {
      modules.replaceChildren();
      const needle = query.trim().toLowerCase();
      const visible = course.modules.filter((module) => {
        if (!needle) return true;
        return module.title.toLowerCase().includes(needle)
          || module.lessons.some((lesson) => lesson.number.includes(needle) || lesson.title.toLowerCase().includes(needle) || lesson.originalTitle.toLowerCase().includes(needle));
      });
      if (visible.length === 0) {
        modules.append(node('p', 'course-empty', '没有匹配的模块或课节。'));
        return;
      }
      visible.forEach((module, moduleIndex) => {
        const details = node('details', 'course-module');
        details.open = needle.length > 0 || opened.has(module.id);
        const summary = node('summary', 'course-module-head');
        summary.append(
          node('span', 'course-module-index', String(moduleIndex + 1).padStart(2, '0')),
        );
        const main = node('span', 'course-module-main');
        main.append(
          node('span', 'course-module-title', module.title),
          node('span', 'course-module-sub', `${module.lessons.length} 节`),
        );
        summary.append(main, node('span', 'course-chevron', '›'));
        details.append(summary);

        const body = node('div', 'course-lessons');
        details.append(body);
        const fill = (): void => {
          if (body.childElementCount > 0) return;
          module.lessons.forEach((lesson) => body.append(lessonCard(module, lesson)));
        };
        details.addEventListener('toggle', () => {
          if (!details.isConnected) return;
          if (details.open) {
            opened.add(module.id);
            fill();
          } else {
            opened.delete(module.id);
          }
        });
        if (details.open) fill();
        modules.append(details);
      });
    };

    search.addEventListener('input', () => { query = search.value; drawModules(); });
    drawModules();
  };

  const render = (): void => {
    if (selected) renderCourse(selected);
    else renderLibrary();
  };

  try {
    render();
  } catch (error) {
    notice = `课程库加载失败：${error instanceof Error ? error.message : '请刷新重试'}`;
    root.replaceChildren();
    const panel = node('section', 'panel course-panel');
    const status = node('p', 'course-notice', notice);
    status.setAttribute('role', 'status');
    panel.append(status);
    root.append(panel);
  }
}
