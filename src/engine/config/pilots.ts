import type { Lesson } from '../ports';
import { EXERCISE_EXAMPLES, lessonForExercise } from './exercises';
import { INTERVAL_COMPARISON_COURSE, SCALE_IDENTIFICATION_COURSE, TRIAD_INVERSION_COURSE } from './courses';

export interface PilotCase {
  readonly id: string;
  readonly title: string;
  readonly material: string;
  readonly source: string;
  readonly seed: number;
  readonly lesson: Lesson;
}

export const PILOT_CASES: readonly PilotCase[] = [
  { id: 'chord', title: '和弦辨认', material: '大三 / 小三 · 同时发声', source: 'Std:a1:m1', seed: 20261103,
    lesson: { id: 'pilot:chord', title: '和弦辨认', module: 'chord', skills: ['chord.identify.maj', 'chord.identify.min'], directions: ['harmonic'], source: 'custom' } },
  { id: 'interval', title: '音程辨认', material: '小三度 / 大三度 · 上行', source: 'Std:a2:m2', seed: 20261103,
    lesson: { id: 'pilot:interval', title: '音程辨认', module: 'interval', skills: ['interval.identify.m3', 'interval.identify.M3'], directions: ['asc'], source: 'custom' } },
  { id: 'inversion', title: '和弦转位', material: '大三和弦 · 原位 / 第一转位', source: 'Std:a7（本地材料）', seed: 20261103,
    lesson: TRIAD_INVERSION_COURSE.modules[0]!.lessons[0]!.lesson! },
  { id: 'scale', title: '音阶辨认', material: '大调 / 自然小调 / 和声小调', source: 'Std:a8（本地基础子集）', seed: 20261103,
    lesson: SCALE_IDENTIFICATION_COURSE.modules[0]!.lessons[2]!.lesson! },
  { id: 'comparison', title: '音程比较', material: '纯四 / 纯五 / 八度 · 共同起音', source: 'Std:a3:m1', seed: 20261103,
    lesson: INTERVAL_COMPARISON_COURSE.modules[0]!.lessons[0]!.lesson! },
  ...EXERCISE_EXAMPLES.map((example): PilotCase => ({
    id: example.kind, title: example.title, seed: 20261103,
    material: example.kind === 'harmony-progression' ? 'I–IV–V–I / I–ii–V–I' : example.kind === 'interval-singing'
      ? '大三上行 / 小三下行' : example.kind.startsWith('rhythm-') ? '4/4 · 一小节 · 四分、八分与休止' : 'C 大调 · 一小节短句',
    source: 'Std 同名专项（独立编写代表材料）',
    lesson: lessonForExercise({ ...example, questionCount: 2 }),
  })),
];
