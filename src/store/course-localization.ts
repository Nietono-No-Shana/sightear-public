export type CourseGroup = 'comprehensive' | 'beginner' | 'vocal' | 'repertoire' | 'graded';

export interface CourseMeta {
  readonly title: string;
  readonly subtitle: string;
  readonly group: CourseGroup;
}

export const COURSE_GROUP_TITLES: Readonly<Record<CourseGroup, string>> = {
  comprehensive: '综合专项',
  beginner: '入门课程',
  vocal: '视唱训练',
  repertoire: '曲目训练',
  graded: '分级考级',
};

export const COURSE_GROUP_ORDER: readonly CourseGroup[] = [
  'comprehensive',
  'beginner',
  'vocal',
  'repertoire',
  'graded',
];

export const HIDDEN_COURSE_IDS: ReadonlySet<string> = new Set();

/** 标题由 content/catalog.json 提供；这里只做兜底。 */
export function courseMeta(_id: string, fallbackTitle: string): CourseMeta {
  return { title: fallbackTitle, subtitle: '', group: 'comprehensive' };
}

export function isCourseHidden(_id: string): boolean {
  return false;
}

export function moduleTitle(_id: string, fallbackTitle: string): string {
  return fallbackTitle;
}

export function lessonTitle(_id: string, originalTitle: string, index: number, contentTitle?: string): string {
  return originalTitle.trim() || contentTitle?.trim() || `第 ${index + 1} 课`;
}
