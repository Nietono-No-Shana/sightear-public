/**
 * 跨层契约。零实现、零 import。
 *
 * 这里是整个项目的"法律"：engine 内部模块之间、engine 与 adapter 之间、
 * engine 与 ui 之间，只通过这些类型通信。新增跨层类型必须先加到这里。
 *
 * 注意：本文件不引用任何 DOM 类型，tsconfig 的 lib 也只有 ES2022，
 * 所以 window / AudioContext / Blob 这类东西在这里会直接编译失败——这是故意的。
 */

// ─────────────────────────────────────────────────────────────
// 基础
// ─────────────────────────────────────────────────────────────

export type Midi = number;
export type Cents = number;
export type Millis = number;
export type Seed = number;
export type PitchClass = number; // 0..11，0 = C

/** 预测成功率 0..1；独立别名防止和 rating 混用。 */
export type SuccessPrediction = number;

export interface Clock {
  now(): Millis;
  /** 本地自然日边界（默认 4:00）；只在 adapter 里用本地时区实现 */
  dayStart(now: Millis): Millis;
}

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [0, maxExclusive) 的整数 */
  int(maxExclusive: number): number;
  /** 派生子流，保证同一父种子下可复现 */
  fork(label: string): Rng;
}

/** 题目内容只从 seed 派生，不依赖会话 RNG 的状态。 */
export interface RngFactory {
  fromSeed(seed: Seed): Rng;
}

// ─────────────────────────────────────────────────────────────
// 乐理与谱面
// ─────────────────────────────────────────────────────────────

export type Clef = 'treble' | 'bass' | 'grand';
export type Mode = 'major' | 'minor';
export type DurationValue = 1 | 2 | 4 | 8 | 16 | 32;

export interface KeySignature {
  tonic: PitchClass;
  mode: Mode;
  /** 五度圈位置，-7..7，负数降号 */
  fifths: number;
}

export interface TimeSignature {
  beats: number;
  unit: 2 | 4 | 8;
}

export interface Tuplet {
  /** 实际音符数，例如三连音是 3 */
  readonly actual: number;
  /** 占用的正常音符数，例如三连音是 2 */
  readonly normal: number;
}

export interface Duration {
  value: DurationValue;
  dots: 0 | 1 | 2;
  /** 连音；缺省表示普通时值 */
  tuplet?: Tuplet;
}

export interface Pitch {
  midi: Midi;
  /** 已拼写音名，如 "F#4"、"Bb3" */
  name: string;
}

export interface ScoreNote {
  /** null 表示休止 */
  pitch: Pitch | null;
  duration: Duration;
  tie: boolean;
}

export interface ScoreVoice {
  notes: ScoreNote[];
}

export interface ScoreMeasure {
  key: KeySignature;
  time: TimeSignature;
  voices: ScoreVoice[];
}

export interface Score {
  clef: Clef;
  measures: ScoreMeasure[];
}

// ─────────────────────────────────────────────────────────────
// 技能
// ─────────────────────────────────────────────────────────────

export type SkillDomain =
  | 'scale'
  | 'interval'
  | 'chord'
  | 'function'
  | 'voiceleading'
  | 'dictation'
  | 'audiation'
  | 'sight'
  | 'rhythm';

/** 三段式：域.动作.对象，如 interval.identify.maj3.melodic */
export type SkillId = `${SkillDomain}.${string}`;

/** 混淆对，如 "P4:P5" */
export type ConfusionKey = `${string}:${string}`;

/** SRS 的条目可以是 skill，也可以是混淆对。 */
export type ScheduleKey = SkillId | ConfusionKey;

export type StageId = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export interface Skill {
  id: SkillId;
  domain: SkillDomain;
  stage: StageId;
  label: string;
}

// ─────────────────────────────────────────────────────────────
// 题目
// ─────────────────────────────────────────────────────────────

export type TimbreId = 'piano' | 'strings' | 'synth' | 'organ';
export type Register = 'low' | 'mid' | 'high';
export type Direction = 'asc' | 'desc' | 'harmonic';
export type Reference = 'none' | 'tonic' | 'chord';

/**
 * 难度的正交轴。回退时改这些值，不改"难度等级"。
 */
export interface ItemFeatures {
  register: Register;
  direction: Direction;
  reference: Reference;
  timbre: TimbreId;
  tempoBpm: number;
  /** 1 / 2 / 4 声部；M1 identify 不适用，留给听写/多声部 */
  voices: 1 | 2 | 4;
  /** M1 identify 不适用，留给听写 */
  bars: number;
  /** 听写时一次处理的音数；M1 identify 不适用 */
  chunk: number;
}

export type ItemKind =
  | 'identify'
  | 'dictation'
  | 'audiation'
  | 'sight'
  | 'tap'
  | 'detect';

export interface ItemInstance {
  id: string;
  /** 同 template 的不同 seed 共享难度先验 */
  templateKey: string;
  skill: SkillId;
  kind: ItemKind;
  seed: Seed;
  features: ItemFeatures;
  /** 本题要复习的 skill / 混淆对；Attempt.reviewKeys 由它加上 observed confusion 组成 */
  targets: readonly ScheduleKey[];
  schemaVersion: 1;
}

/** 发给 UI 的部分：不含答案 */
export interface PresentedItem extends ItemInstance {
  exerciseKind?: ExerciseKind;
  inputLeadIn?: readonly SoundEvent[];
  inputLeadInMs?: Millis;
  notationContext?: { key: KeySignature; time: TimeSignature; measures: number };
  /** 听辨类为 null（不能把答案谱给 UI） */
  score: Score | null;
  /** 听辨类真正播放的内容；由 adapter 排程，不是命令 */
  stimulus: readonly SoundEvent[] | null;
  /** 选择题的选项；非选择题为 null */
  options: readonly string[] | null;
  prompt: string;
}

/** 引擎内部持有的答案，不发给 UI */
export type AnswerKey =
  | { type: 'functions'; symbols: readonly string[] }
  | { type: 'locations'; indices: readonly number[]; size: number }
  | { type: 'performance'; mode: 'tapped' | 'sung' | 'notation'; notes: readonly NoteEvent[]; tempoBpm: number; end: Millis; rhythmOnly: boolean; timing: 'onset' | 'full' | 'none'; policy: PerformancePolicy }
  | { type: 'choice'; index: number }
  | { type: 'notes'; notes: NoteEvent[] }
  | { type: 'score'; score: Score };

// ─────────────────────────────────────────────────────────────
// 作答与判定
// ─────────────────────────────────────────────────────────────

export interface NoteEvent {
  midi: Midi;
  start: Millis;
  dur: Millis;
  /** 相对十二平均律的偏差 */
  cents: Cents;
}

export interface PerformancePolicy {
  grading?: 'graded-v1' | 'graded-v2';
  onsetMs: number;
  durationMs: number;
  pitchCents: number;
  latencyMs: number;
  alignStart: boolean;
}

export interface NoteDifference {
  responseIndices?: readonly number[];
  pitchScore?: number;
  rhythmScore?: number;
  expectedIndex: number | null;
  responseIndex: number | null;
  errors: readonly ErrorType[];
  cents: number | null;
  onsetErrorMs: number | null;
  durationErrorMs: number | null;
}

export type ScoreExerciseKind = 'rhythm-imitation' | 'rhythm-reading' | 'rhythm-correction' |
  'rhythm-dictation' | 'melody-dictation' | 'melody-singing' | 'melody-imitation';
export type ExerciseKind = ScoreExerciseKind | 'harmony-progression' | 'interval-singing';

export interface ExerciseBase {
  id: string;
  version: 1;
  title: string;
  tempoBpm: number;
  itemRating: number;
  questionCount: number;
  policy: PerformancePolicy;
}

export interface ScoreGenerationBase {
  version: 1 | 2 | 3;
  clef: Clef;
  key: KeySignature;
  time: TimeSignature;
  measures: number;
  durations: readonly Duration[];
  restProbability: number;
  ties?: { withinMeasureProbability: number; acrossMeasureProbability: number };
  patterns?: readonly RhythmPattern[];
  required?: { dottedNotes?: number; tripletGroups?: number; withinMeasureTies?: number; acrossMeasureTies?: number };
}

export interface RhythmPattern {
  id: string;
  notes: readonly { duration: Duration; rest: boolean }[];
  minOccurrences: number;
}

export interface MelodyConstraints {
  scale: 'major' | 'naturalMinor' | 'harmonicMinor' | 'melodicMinorAscending';
  degrees: readonly number[];
  startDegrees: readonly number[];
  endDegrees: readonly number[];
  allowRepeatedNotes: boolean;
}

export type ScoreGeneratorSpec =
  | (ScoreGenerationBase & { kind: 'rhythm-grid' })
  | (ScoreGenerationBase & {
      kind: 'diatonic-melody';
      pitchRange: readonly [number, number];
      maxLeapSemitones: number;
      melody?: MelodyConstraints;
    });

export type VocalRangeId = 'original' | 'soprano' | 'mezzo' | 'alto' | 'tenor' | 'baritone' | 'bass';

export interface VocalBounds {
  low: number;
  high: number;
}

export type ExerciseSpec =
  | (ExerciseBase & { kind: 'harmony-progression'; tonics: readonly number[]; mode: 'major' | 'naturalMinor' | 'harmonicMinor'; sequences: readonly (readonly number[])[]; chordSequences?: readonly (readonly HarmonyStep[])[] })
  | (ExerciseBase & { kind: 'interval-singing'; roots: readonly number[]; intervals: readonly { number: number; semitones: number; direction: 'asc' | 'desc' }[] })
  | (ExerciseBase & { kind: ScoreExerciseKind; scores: readonly Score[]; generator?: ScoreGeneratorSpec; correctionShiftTicks?: number });

export type Response =
  | { kind: 'functions'; symbols: readonly string[]; rtMs: Millis }
  | { kind: 'locations'; indices: readonly number[]; rtMs: Millis }
  | { kind: 'choice'; index: number; rtMs: Millis }
  | { kind: 'notation'; score: Score; rtMs: Millis }
  | { kind: 'sung'; notes: NoteEvent[]; rtMs: Millis }
  | { kind: 'tapped'; onsets: Millis[]; rtMs: Millis };

export type ErrorType =
  | 'none'
  | 'pitch'
  | 'rhythm'
  | 'function'
  | 'voicing'
  | 'modulation'
  | 'omission'
  | 'extra';

export interface Judgement {
  details?: readonly NoteDifference[];
  pitchScore?: number;
  rhythmScore?: number;
  /** 是否算通过；correct=true 时 partial 必须为 1，scoreOf 会校验 */
  correct: boolean;
  /** 0..1，部分分 */
  partial: number;
  errorType: ErrorType;
  /** 可归因时为混淆对，否则 null */
  confusion: ConfusionKey | null;
  /** 视唱类的逐音偏差 */
  cents: readonly Cents[] | null;
  rtMs: Millis;
}

// ─────────────────────────────────────────────────────────────
// 事实与派生态
// ─────────────────────────────────────────────────────────────

/** 唯一的持久化真相 */
export interface Attempt {
  id: string;
  itemId: string;
  templateKey: string;
  skill: SkillId;
  /** 作答时的题目难度 b；必须快照，priors 改动后仍能重放 ability */
  itemRating: number;
  /** 出题时的预测成功率；校准用，不能事后回填 */
  predictedP: SuccessPrediction;
  /** 本次实际复习的 key：skill + 题目 targets + observed confusion */
  reviewKeys: readonly ScheduleKey[];
  at: Millis;
  judgement: Judgement;
  /** 旧数据缺省按 daily 处理 */
  context?: 'daily' | 'focus' | 'test' | 'lesson';
  /** GNU lesson / 自定义题集；用于按 lesson 聚合统计 */
  lessonId?: string;
  /** 2 = 快照 templateKey / itemRating / predictedP / reviewKeys */
  schemaVersion: 2;
}

export interface AbilityState {
  skill: SkillId;
  /** 内部能力坐标 θ；不展示、不跨 skill 比较 */
  rating: number;
  n: number;
  updatedAt: Millis;
}

export interface ScheduleEntry {
  key: ScheduleKey;
  dueAt: Millis;
  intervalDays: number;
  ease: number;
  reps: number;
}

export interface ConfusionStat {
  key: ConfusionKey;
  count: number;
  lastAt: Millis;
}

export interface DerivedSnapshot {
  ability: readonly AbilityState[];
  schedule: readonly ScheduleEntry[];
  confusion: readonly ConfusionStat[];
}

// ─────────────────────────────────────────────────────────────
// 会话
// ─────────────────────────────────────────────────────────────

export type BlockKind = 'warmup' | 'core' | 'dictation' | 'production' | 'review';

export type PracticeMode = 'daily' | 'focus';
export type PracticeDomain = 'interval' | 'chord' | 'scale' | 'function' | 'rhythm' | 'dictation' | 'sight' | 'audiation';
export type PracticeScope = PracticeDomain | 'mixed';
export type FocusKind = 'due' | 'pair' | 'skill' | 'new' | 'mixed';

/** GNU Solfege lesson 的最小语义：题集 + 方向 + 可选的覆盖率测试。 */
export interface LessonTest {
  /** GNU 的 "3x"：每个题各出现 3 次 */
  repetitions: number;
  /** GNU 的 "90%"：通过阈值 0..1 */
  requirement: number;
}

export interface Lesson {
  exerciseSpec?: ExerciseSpec;
  practiceSpec?: ChoicePracticeSpec;
  practiceSpecId?: string;
  id: string;
  title: string;
  module: PracticeDomain;
  skills: readonly SkillId[];
  directions: readonly Direction[];
  test?: LessonTest;
  source: 'gnu' | 'catalog' | 'custom';
}

export interface ChordVoicing {
  readonly bassDegree: number;
  readonly omitDegrees: readonly number[];
  readonly spread: 'stacked' | 'open';
}

export interface HarmonyStep {
  readonly degree: number;
  readonly code: string;
  readonly voicing?: ChordVoicing;
}

export type ScaleMode =
  | 'major' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'naturalMinor' | 'locrian'
  | 'harmonicMinor' | 'melodicMinor'
  | 'dorianFlat2' | 'lydianAugmented' | 'lydianDominant' | 'mixolydianFlat6' | 'locrianSharp2' | 'altered'
  | 'locrianSharp6' | 'ionianSharp5' | 'dorianSharp4' | 'phrygianDominant' | 'lydianSharp2' | 'ultralocrian'
  | 'wholeTone' | 'diminishedWholeHalf' | 'diminishedHalfWhole'
  | 'pentatonicMajor' | 'pentatonicMinor';

export type ChoiceTask =
  | { readonly kind: 'interval-identification'; readonly codes: readonly string[] }
  | { readonly kind: 'chord-identification'; readonly codes: readonly string[]; readonly voicing?: ChordVoicing }
  | { readonly kind: 'chord-inversion'; readonly qualities: readonly ('major' | 'minor' | 'diminished' | 'augmented' | 'suspended4' | 'majorFlat5' | 'majorSharp5' | 'dominant7' | 'major7' | 'minor7' | 'halfDiminished7' | 'diminished7' | 'minorMajor7' | 'diminishedMajor7' | 'dominant7Flat5' | 'dominant7Sharp5' | 'major7Flat5' | 'major7Sharp5' | 'dominant7sus4' | 'major7sus4')[]; readonly inversions: readonly (0 | 1 | 2 | 3)[] }
  | { readonly kind: 'scale-identification'; readonly modes: readonly ScaleMode[] }
  | { readonly kind: 'interval-comparison'; readonly semitones: readonly number[]; readonly commonTone: 'first'; readonly allowEqual: boolean };

export interface ChoicePracticeSpec {
  readonly id: string;
  readonly version: 1;
  readonly title: string;
  readonly provenance: 'local-design';
  readonly sourceTopic: { readonly courseId: string; readonly activity: 1 | 2 | 3 | 7 | 8 };
  readonly task: ChoiceTask;
  readonly stimulus: {
    readonly direction: 'asc' | 'desc' | 'harmonic';
    readonly rootMidi: readonly [number, number];
    readonly tempoBpm: number;
    readonly reference: Reference;
    readonly gapBeats: number;
  };
  readonly questionCount: number;
  readonly scoring: 'exact-choice-v1';
  readonly availability: 'planned' | 'engine-ready' | 'playable';
}

/** 课程层只负责顺序；具体题目仍由 Lesson 描述。 */
export type CourseLessonKind = 'identify' | 'unsupported';

export interface CourseSourceLocation {
  activityNumber: number;
  activityTitle: string;
  moduleNumber: number;
  lessonNumber?: number;
  titleProvided: boolean;
}

export interface CourseLesson {
  id: string;
  title: string;
  description?: string;
  kind: CourseLessonKind;
  /** kind=identify 时存在 */
  lesson?: Lesson;
  /** 这一课做多少题；EM 式固定题量。 */
  questionCount?: number;
  sourceLocation?: CourseSourceLocation;
}

export interface CourseModule {
  id: string;
  title: string;
  lessons: readonly CourseLesson[];
  sourceLocation?: CourseSourceLocation;
}

export interface Course {
  id: string;
  title: string;
  description?: string;
  source: 'catalog' | 'custom';
  modules: readonly CourseModule[];
}

export interface TrainingFocus {
  kind: FocusKind;
  skill?: SkillId;
  pair?: ConfusionKey;
  reason: string;
}

export interface PracticeRequest {
  mode: PracticeMode;
  scope: PracticeScope;
  /** focus 模式必填，且 kind 只能是 pair / skill；有 lesson 时可省略 */
  focus?: TrainingFocus;
  /** GNU 预设/自定义 lesson；有它时 scope 由 lesson 决定 */
  lesson?: Lesson;
  /** 默认音源；缺省 piano */
  timbre?: TimbreId;
  /** 5 / 10 / 15；focus 模式用 */
  limit?: number;
  /** daily 默认 25 分钟，focus 默认 10 分钟 */
  durationMs?: number;
  /** 默认 0.82 */
  targetP?: number;
}

export interface SessionBlock {
  kind: BlockKind;
  budgetMs: Millis;
}

export interface SessionPlan {
  stage: StageId;
  blocks: readonly SessionBlock[];
  totalMs: Millis;
  mode: PracticeMode;
  scope: PracticeScope;
  targetP: number;
  timbre: TimbreId;
  focus: TrainingFocus;
  lesson?: Lesson;
}

export interface Gate {
  accuracy: number;
  medianRtMs: Millis;
  production: number;
  retention: number;
  minAttempts: number;
}

// ─────────────────────────────────────────────────────────────
// 音频（输出是事件表，不是命令）
// ─────────────────────────────────────────────────────────────

export type SoundEvent =
  | {
      kind: 'note';
      midi: Midi;
      velocity: number;
      start: Millis;
      dur: Millis;
      timbre: TimbreId;
    }
  | {
      kind: 'chord';
      midis: readonly Midi[];
      start: Millis;
      dur: Millis;
      timbre: TimbreId;
    }
  | { kind: 'click'; start: Millis; accent: boolean };

export interface AudioOut {
  /** 同步返回；排程由 adapter 负责，引擎不等待 */
  schedule(events: readonly SoundEvent[], origin: Millis): void;
  now(): Millis;
}

export interface PitchFrame {
  t: Millis;
  f0: number;
  clarity: number;
  rms: number;
}

export interface PcmRecording {
  readonly sampleRate: number;
  readonly samples: Float32Array;
}

export interface AudioIn {
  start(): Promise<void>;
  frames(): AsyncIterable<PitchFrame>;
  stop(): void;
}

// ─────────────────────────────────────────────────────────────
// 记谱（引擎只产出 ViewModel）
// ─────────────────────────────────────────────────────────────

export interface NoteViewModel {
  midi: Midi | null;
  name: string;
  duration: Duration;
  tie: boolean;
}

export interface VoiceViewModel {
  notes: readonly NoteViewModel[];
}

export interface MeasureViewModel {
  key: KeySignature;
  time: TimeSignature;
  voices: readonly VoiceViewModel[];
}

export interface ScoreViewModel {
  clef: Clef;
  measures: readonly MeasureViewModel[];
}

export interface PitchPoint {
  t: Millis;
  midi: number;
  cents: Cents;
}

export interface Notation {
  render(vm: ScoreViewModel): void;
  setCursor(p: { measure: number; beat: number }): void;
  overlay(trace: readonly PitchPoint[]): void;
}

// ─────────────────────────────────────────────────────────────
// 存储
// ─────────────────────────────────────────────────────────────

export interface Storage {
  loadAll(): Promise<readonly Attempt[]>;
  append(a: Attempt): Promise<void>;
  /** 导出为 JSON 文本，不返回 Blob（DOM 类型不能进 engine） */
  exportJson(): Promise<string>;
}

// ─────────────────────────────────────────────────────────────
// 引擎门面
// ─────────────────────────────────────────────────────────────

export interface Engine {
  planSession(
    now: Millis,
    request: PracticeRequest,
    snapshot: DerivedSnapshot,
  ): SessionPlan;
  nextItem(
    plan: SessionPlan,
    snapshot: DerivedSnapshot,
    now: Millis,
    rng: Rng,
    rngFactory: RngFactory,
  ): {
    presented: PresentedItem;
    key: AnswerKey;
    itemRating: number;
    predictedP: SuccessPrediction;
  };
  judge(presented: PresentedItem, key: AnswerKey, response: Response): Judgement;
  /** 由 attempts 重放得到派生态 */
  snapshot(attempts: readonly Attempt[], now: Millis): DerivedSnapshot;
}
