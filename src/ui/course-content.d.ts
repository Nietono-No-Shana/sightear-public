declare module 'virtual:course-library' {
  export const summaries: import('../store/course-loading').CourseSummary[];
  export const loaders: Record<string, () => Promise<import('../store/course-loading').CourseIndex>>;
}
