import type { Course, CourseLesson, Direction, Lesson, SkillId } from '../ports';
import { CATALOG_COURSES } from './catalog-courses';
import { ALL_PRACTICE_SPECS, INITIAL_PRACTICE_SPECS, inversionSkillsForSpec, skillsForPracticeSpec, type ChoicePracticeSpec } from './practice-specs';
import { INVERSION_QUALITY_LABELS } from './skills';

function chordLesson(
  id: string,
  title: string,
  codes: readonly string[],
  directions: readonly Direction[] = ['harmonic'],
  source: 'catalog' | 'custom' = 'custom',
): Lesson {
  return {
    id: `course:${id}`,
    title,
    module: 'chord',
    skills: codes.map((code) => `chord.identify.${code}` as SkillId),
    directions,
    source,
  };
}

function intervalLesson(
  id: string,
  title: string,
  description: string,
  codes: readonly string[],
  directions: readonly Direction[] = ['asc', 'desc'],
  questionCount = 8,
): CourseLesson {
  return {
    id: `interval:${id}`,
    title,
    description,
    kind: 'identify',
    lesson: {
      id: `course:interval:${id}`,
      title,
      module: 'interval',
      skills: codes.map((code) => `interval.identify.${code}` as SkillId),
      directions,
      source: 'custom',
    },
    questionCount,
  };
}

/**
 * Std 前 22 个和弦模块的原始标题。能映射到现有和弦模型的写 code，
 * 需要 added-tone / major6 / altered maj7 的模块先标 null，不伪造题目。
 */
const STD_CHORD_SKILLS: readonly (readonly string[] | null)[] = [
  ['maj', 'min'], // 1 Identify the Major & the Minor Chords
  ['maj', 'min', 'sus4'], // 2 Major, Minor & Sus4
  ['maj', 'majb5', 'maj#5'], // 3 Major Chords with Alternating 5th
  ['min', 'dim'], // 4 Minor & Minor(b5)
  ['sus2', 'sus4'], // 5 Sus Chords
  ['majb5', 'maj#5', 'dim', 'aug'], // 6 Triads with Altered 5th
  ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4'], // 7 All Triads
  ['maj', 'maj6', 'majadd9'], // 8 Major Triad with Added Chord Tone
  ['min', 'min6', 'minadd9'], // 9 Minor Triad with Added Chord Tone
  ['dim', 'm7b5'], // 10 Minor(b5) with Added Chord Tone
  ['majb5', 'maj6b5', 'maj7b5'], // 11 Major(b5) with Added Chord Tone
  ['maj#5', 'maj6#5', 'maj7#5'], // 12 Major(#5) with Added Chord Tone
  ['sus4', '7sus4'], // 13 Sus Triads with Added Minor 7th
  ['sus4', 'maj7sus4'], // 14 Sus Triads with Added Major 7th
  ['sus4', '7sus4', 'maj7sus4'], // 15 Sus Seventh Chords
  ['maj7', 'maj7b5', 'maj7#5'], // 16 Maj7 with Perfect/Altered 5th
  ['dom7', '7b5', '7#5'], // 17 7th with Perfect/Altered 5th
  ['min7', 'm7b5', 'maj7', 'maj7b5', 'maj7#5'], // 18 Minor7 & Maj7 with Perfect/Altered 5th
  ['maj7', 'maj7b5', 'maj7#5'], // 19 All Maj7
  ['min7', 'dom7', 'm7b5'], // 20 All Chords with Minor 7th
  ['maj6', 'dim7'], // 21 Major 6th or Diminished 7
  ['dom7', 'min7', 'maj7', 'm7b5', 'dim7'], // 22 All 7th Chords
];

// The public build ships an empty catalog: the engine still runs from its
// hand-written courses, and the catalog-derived ones simply disappear.
const STD = CATALOG_COURSES.find((course) => course.id === 'catalog:Std');
const STD_MODULES = STD?.modules ?? [];

const STD_WORKSHOP_TITLES: Readonly<Record<number, string>> = {
  1: '和弦辨认',
  2: '音程辨认',
  3: '音程比较',
  4: '节奏模仿',
  5: '节奏视读',
  6: '节奏纠错',
  7: '和弦转位',
  8: '音阶辨认',
  9: '旋律听写',
  10: '和声进行',
  11: '节奏听写',
  12: '音程视唱',
  13: '旋律视唱',
  14: '旋律模唱',
};

function stdWorkshopCourses(): readonly Course[] {
  const activities = [...new Set(STD_MODULES.map((module) => module.sourceLocation?.activityNumber))];
  return activities.map((activityNumber) => {
    if (activityNumber === undefined) throw new Error('missing Std workshop activity');
    const title = STD_WORKSHOP_TITLES[activityNumber];
    if (title === undefined) throw new Error(`missing Std workshop title ${activityNumber}`);
    return {
      id: `catalog:Std:activity:${activityNumber}`,
      title,
      source: 'catalog',
      modules: STD_MODULES.filter((module) => module.sourceLocation?.activityNumber === activityNumber),
    };
  });
}

export const STD_WORKSHOP_COURSES: readonly Course[] = stdWorkshopCourses();

const STD_DIRECTION_SETS: readonly (readonly Direction[])[] = [
  ['asc'],
  ['desc'],
  ['harmonic'],
  ['harmonic', 'asc', 'desc'],
];

const STD_DIRECTION_LABELS = [
  'Ascending',
  'Descending',
  'Harmonic',
  'Harmonic, Ascending & Descending',
] as const;

function stdChordCourse(): Course {
  const modules = STD_MODULES.filter((module) => module.sourceLocation?.activityNumber === 1).map((module, moduleIndex) => {
    const skills = STD_CHORD_SKILLS[moduleIndex];
    if (skills === undefined) throw new Error(`missing Std chord mapping ${moduleIndex + 1}`);
    const sourceLessons =
      module.lessons.length === 4 && module.lessons.every((lesson) => lesson.sourceLocation?.titleProvided)
        ? module.lessons
        : STD_DIRECTION_LABELS.map((label) => ({ title: `${module.title} - ${label}` }));

    return {
      id: `std-chord:${moduleIndex + 1}`,
      title: module.title,
      lessons: sourceLessons.map((sourceLesson, lessonIndex) => {
        const id = `std-chord:${moduleIndex + 1}:${lessonIndex + 1}`;
        if (skills === null) {
          return {
            id,
            title: sourceLesson.title,
            kind: 'unsupported' as const,
          };
        }
        const directions = STD_DIRECTION_SETS[lessonIndex] ?? ['harmonic'];
        return {
          id,
          title: sourceLesson.title,
          kind: 'identify' as const,
          lesson: chordLesson(id, sourceLesson.title, skills, directions, 'catalog'),
          questionCount: 8,
        };
      }),
    };
  });

  return {
    id: 'catalog:Std:chord-1-22',
    title: '和弦辨认',
    description: '本地改编练习，每课 8 题。',
    source: 'catalog',
    modules,
  };
}

export const STD_CHORD_COURSE: Course = stdChordCourse();

const STD_INTERVAL_SKILLS: readonly (readonly string[])[] = [
  ['m2', 'M2'], // 23
  ['m3', 'M3'], // 24
  ['m2', 'M2', 'm3', 'M3'], // 25
  ['p4', 'tt'], // 26
  ['tt', 'p5'], // 27
  ['p4', 'tt', 'p5'], // 28
  ['m2', 'M2', 'm3', 'M3', 'p4', 'tt', 'p5'], // 29
  ['m6', 'M6'], // 30
  ['m7', 'M7'], // 31
  ['m6', 'M6', 'm7', 'M7'], // 32
  ['p4', 'tt', 'p5', 'm6', 'M6', 'm7', 'M7'], // 33
  ['m2', 'M2', 'm3', 'M3', 'p4', 'tt', 'p5', 'm6', 'M6', 'm7', 'M7'], // 34
  ['p4', 'p5', 'p8'], // 35 perfect
  ['m3', 'M3', 'p4', 'p5', 'm6', 'M6', 'p8'], // 36 consonant
  ['m2', 'M2', 'tt', 'm7', 'M7'], // 37 dissonant
  ['m2', 'M2', 'm3', 'M3', 'p4', 'tt', 'p5', 'm6', 'M6', 'm7', 'M7', 'p8'], // 38
];

function stdIntervalCourse(): Course {
  const modules = STD_MODULES.filter((module) => module.sourceLocation?.activityNumber === 2).map((module, moduleIndex) => {
    const codes = STD_INTERVAL_SKILLS[moduleIndex];
    if (codes === undefined) throw new Error(`missing Std interval mapping ${moduleIndex + 23}`);
    return {
      id: `std-interval:${moduleIndex + 1}`,
      title: module.title,
      lessons: STD_DIRECTION_LABELS.map((label, lessonIndex) => {
        const id = `std-interval:${moduleIndex + 1}:${lessonIndex + 1}`;
        const directions = STD_DIRECTION_SETS[lessonIndex] ?? ['harmonic'];
        return {
          id,
          title: `${module.title} - ${label}`,
          kind: 'identify' as const,
          lesson: {
            id: `course:std-interval:${moduleIndex + 1}:${lessonIndex + 1}`,
            title: `${module.title} - ${label}`,
            module: 'interval' as const,
            skills: codes.map((code) => `interval.identify.${code}` as SkillId),
            directions,
            source: 'catalog' as const,
          },
          questionCount: 8,
        };
      }),
    };
  });

  return {
    id: 'catalog:Std:interval-23-38',
    title: '音程辨认',
    description: '本地改编练习，每课 8 题。',
    source: 'catalog',
    modules,
  };
}

export const STD_INTERVAL_COURSE: Course = stdIntervalCourse();

function inversionModuleTitle(spec: ChoicePracticeSpec): string {
  if (spec.task.kind !== 'chord-inversion') throw new Error('expected inversion spec');
  if (spec.task.qualities.length === 2) return '大小三和弦混合';
  if (spec.task.qualities.length > 2) return '七和弦混合';
  return INVERSION_QUALITY_LABELS[spec.task.qualities[0]!];
}

function triadInversionCourse(): Course {
  const specs = ALL_PRACTICE_SPECS.filter(
    (spec): spec is ChoicePracticeSpec & { task: Extract<ChoicePracticeSpec['task'], { kind: 'chord-inversion' }> } =>
      spec.task.kind === 'chord-inversion',
  );
  const modules = [...new Set(specs.map(inversionModuleTitle))].map((title) => ({
    id: `triad-inversion:${title}`,
    title,
    lessons: specs.filter((spec) => inversionModuleTitle(spec) === title).map((spec) => {
      const skills = inversionSkillsForSpec(spec);
      const lesson: Lesson = {
        id: spec.id,
        practiceSpecId: spec.id,
        title: spec.title,
        module: 'chord',
        skills,
        directions: ['harmonic'],
        source: 'custom',
      };
      return {
        id: spec.id,
        title: spec.title,
        kind: 'identify' as const,
        lesson,
        questionCount: spec.questionCount,
      };
    }),
  }));
  return {
    id: 'course:triad-inversion',
    title: '和弦转位',
    description: '三和弦与七和弦转位，本地分步实现。',
    source: 'custom',
    modules,
  };
}

export const TRIAD_INVERSION_COURSE: Course = triadInversionCourse();

export const SCALE_IDENTIFICATION_COURSE: Course = {
  id: 'course:scale-identification', title: '音阶辨认', source: 'custom',
  description: '大调、自然小调与和声小调。',
  modules: [{
    id: 'scale:basic-modes', title: '三种基本音阶',
    lessons: INITIAL_PRACTICE_SPECS.filter((spec) => spec.task.kind === 'scale-identification').map((spec) => ({
      id: spec.id, title: spec.title, kind: 'identify', questionCount: spec.questionCount,
      lesson: {
        id: spec.id, practiceSpecId: spec.id, title: spec.title, module: 'scale',
        skills: skillsForPracticeSpec(spec), directions: [spec.stimulus.direction], source: 'custom',
      },
    })),
  }],
};

export const INTERVAL_COMPARISON_COURSE: Course = {
  id: 'course:interval-comparison', title: '音程比较', source: 'custom', description: '共同起音的纯音程比较。',
  modules: [{
    id: 'comparison:common-first', title: '共同起音',
    lessons: INITIAL_PRACTICE_SPECS.filter((spec) => spec.task.kind === 'interval-comparison').map((spec) => ({
      id: spec.id, title: spec.title, kind: 'identify', questionCount: spec.questionCount,
      lesson: {
        id: spec.id, practiceSpecId: spec.id, title: spec.title, module: 'interval',
        skills: skillsForPracticeSpec(spec), directions: [spec.stimulus.direction], source: 'custom',
      },
    })),
  }],
};

export const INTERVAL_COURSE: Course = {
  id: 'course:interval-identification',
  title: '音程识别',
  description: '听两音，判断音程；先小步，再混合。',
  source: 'custom',
  modules: [
    {
      id: 'interval:seconds',
      title: '二度',
      lessons: [
        intervalLesson('seconds', '小二与大二', '半音与全音。', ['m2', 'M2']),
      ],
    },
    {
      id: 'interval:thirds',
      title: '三度',
      lessons: [
        intervalLesson('thirds', '小三与大三', '先听三度，不和二度混。', ['m3', 'M3']),
        intervalLesson('seconds-thirds', '二度与三度混合', '二、三度一起辨。', ['m2', 'M2', 'm3', 'M3']),
      ],
    },
    {
      id: 'interval:perfect',
      title: '四度、三全音与五度',
      lessons: [
        intervalLesson('fourth-tritone', '纯四与三全音', '五度圈两侧的张力。', ['p4', 'tt']),
        intervalLesson('tritone-fifth', '三全音与纯五', '三全音 vs 纯五。', ['tt', 'p5']),
        intervalLesson('perfect', '纯四、三全音、纯五', '三个一起辨。', ['p4', 'tt', 'p5']),
      ],
    },
    {
      id: 'interval:sixths',
      title: '六度',
      lessons: [
        intervalLesson('sixths', '小六与大六', '六度的两种色彩。', ['m6', 'M6']),
      ],
    },
    {
      id: 'interval:sevenths',
      title: '七度',
      lessons: [
        intervalLesson('sevenths', '小七与大七', '小七 vs 大七。', ['m7', 'M7']),
      ],
    },
    {
      id: 'interval:all',
      title: '全部简单音程',
      lessons: [
        intervalLesson(
          'all-simple',
          '全部简单音程',
          'm2 到 P8，共 12 个。',
          ['m2', 'M2', 'm3', 'M3', 'p4', 'tt', 'p5', 'm6', 'M6', 'm7', 'M7', 'p8'],
          ['asc', 'desc'],
          10,
        ),
      ],
    },
  ],
};

export const COURSES: readonly Course[] = [
  ...[STD_CHORD_COURSE, STD_INTERVAL_COURSE].filter((course) => course.modules.length > 0),
  TRIAD_INVERSION_COURSE,
  ...CATALOG_COURSES.flatMap((course) =>
    course.id === 'catalog:Std'
      ? STD_WORKSHOP_COURSES.filter((workshop) =>
          workshop.id !== 'catalog:Std:activity:1' &&
          workshop.id !== 'catalog:Std:activity:2' &&
          workshop.id !== 'catalog:Std:activity:7',
        )
      : [course],
  ),
];
