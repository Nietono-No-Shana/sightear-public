import type { Attempt, Clock, Judgement, Pitch, PitchFrame, Response, RngFactory, Score, ScoreViewModel, Storage, TimbreId } from '../engine/ports';
import { midiToName, scoreTimeline } from '../engine/theory';
import { PILOT_CASES, EXERCISE_EXAMPLES, SKILL_BY_ID, lessonForExercise, getSkill, vocalLesson, parseContentPack, lessonForContent, type VocalRangeId, type PilotCase } from '../engine/config';
import { commit as commitSession, createSession, nextItem } from '../engine/session';
import { judge } from '../engine/scoring';
import { estimatePitch, segmentPitchFrames, pitchFromFrame } from '../engine/performance';
import type { NextItem } from '../engine/selection';
import type { VocalBounds } from '../engine/ports';

export { PILOT_CASES };
export const pitchName = midiToName;
export { pitchFromFrame };

export function pilotReference(item: NextItem): Pitch | null {
  if (item.presented.exerciseKind?.startsWith('rhythm-')) return null;
  if (item.presented.exerciseKind === 'interval-singing') {
    const reference = item.presented.stimulus?.find((event) => event.kind === 'note');
    return reference?.kind === 'note' ? { midi: reference.midi, name: midiToName(reference.midi) } : null;
  }
  const kind = getSkill(item.presented.skill).kind;
  if (kind === 'chord' || kind === 'chord-inversion') {
    return [...item.answerPitches].sort((first, second) => first.midi - second.midi)[0] ?? null;
  }
  if (kind === 'interval' && item.presented.features.direction === 'desc') return item.answerPitches[1] ?? null;
  return item.answerPitches[0] ?? null;
}

export function scoreView(score: Score): ScoreViewModel {
  return { clef: score.clef, measures: score.measures.map((measure) => ({ ...measure,
    voices: measure.voices.map((voice) => ({ notes: voice.notes.map((note) => ({
      midi: note.pitch?.midi ?? null, name: note.pitch?.name ?? '', duration: note.duration, tie: note.tie,
    })) })),
  })) };
}
export type { PilotCase } from '../engine/config';

export function contentPilotCases(value: unknown, seed = 42): readonly PilotCase[] {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be in 0..4294967295');
  const pack = parseContentPack(value);
  return [...pack.lessons].sort((first, second) => first.order - second.order).map((entry) => {
    const id = `content:${pack.packId}@${pack.revision}:${entry.id}`;
    const spec = { ...entry.spec, id };
    return { id, seed, title: entry.spec.title, source: `${pack.packId}@${pack.revision} · ${entry.source.evidence}`,
      material: 'kind' in spec ? `${spec.kind} · ${spec.questionCount} 题` : `${spec.task.kind} · ${spec.questionCount} 题`,
      lesson: lessonForContent({ ...entry, id, spec }) };
  });
}

export function customPilotCase(score: Score, tempoBpm: number): PilotCase {
  if (!Number.isFinite(tempoBpm) || tempoBpm < 40 || tempoBpm > 200) throw new RangeError('速度范围为 40–200 BPM');
  const timeline = scoreTimeline(score, tempoBpm);
  if (score.measures.length > 8 || timeline.size > 128 || timeline.end > 120000 || !timeline.notes.length
    || !['treble', 'bass'].includes(score.clef)) throw new RangeError('请使用 1–8 小节、最多 128 个音符或休止的单声部旋律，且至少包含一个音');
  const source = EXERCISE_EXAMPLES.find((spec) => spec.kind === 'melody-singing')!;
  return { id: 'custom-melody', title: '自编旋律视唱', source: '用户编写', material: '自编单声部旋律', seed: 20261103,
    lesson: lessonForExercise({ ...source, kind: 'melody-singing', id: 'custom:melody', title: '自编旋律视唱', questionCount: 1,
      tempoBpm, scores: [structuredClone(score)] }) };
}

export const pilotLabels: Readonly<Record<string, string>> = {
  ...Object.fromEntries([...SKILL_BY_ID.values()].filter((skill) => skill.kind === 'chord').map((skill) => [skill.code, skill.label])),
  ...Object.fromEntries([...SKILL_BY_ID.values()].filter((skill) => skill.kind === 'scale').map((skill) => [skill.code, skill.label])),
  maj: '大三和弦', min: '小三和弦', m3: '小三度', M3: '大三度', root: '原位', first: '第一转位', second: '第二转位', third: '第三转位',
  major: '大调', naturalMinor: '自然小调', harmonicMinor: '和声小调', 'a-larger': 'A 更大', 'b-larger': 'B 更大', equal: '相同',
};

export async function createPilotStore(storage: Storage, clock: Clock, factory: RngFactory, timbre: TimbreId, vocalRange: VocalRangeId = 'original', vocalBounds?: VocalBounds, mode: 'pilot' | 'course' = 'pilot') {
  let attempts = await storage.loadAll();
  let active: ReturnType<typeof createSession> | null = null;
  let random = factory.fromSeed(0);
  let current: NextItem | null = null;
  let saving = false;
  let baseline = 0;
  const startCase = (example: PilotCase): NextItem => {
    if (saving) throw new Error('正在保存');
    baseline = attempts.length;
    active = createSession(mode === 'course' ? attempts : [], clock.now(), { mode: 'focus', scope: example.lesson.module,
      lesson: vocalLesson(example.lesson, vocalRange, vocalBounds), limit: example.lesson.exerciseSpec?.questionCount ?? example.lesson.practiceSpec?.questionCount ?? 2, timbre }, clock);
    random = factory.fromSeed(example.seed).fork(`pilot-course-v1:${example.id}`);
    current = nextItem(active, clock.now(), random, factory);
    if (!current) throw new Error('没有生成题目');
    return current;
  };
  return {
    cases: PILOT_CASES,
    startCase,
    start(id: string): NextItem {
      if (saving) throw new Error('正在保存');
      const example = PILOT_CASES.find((entry) => entry.id === id);
      if (!example) throw new RangeError('未知试练');
      return startCase(example);
    },
    next(): NextItem | null {
      if (!active || current || saving) throw new Error('请先提交当前题');
      current = nextItem(active, clock.now(), random, factory);
      return current;
    },
    async commit(response: Response): Promise<Judgement> {
      if (!active || !current || saving) throw new Error('当前题不能重复提交');
      saving = true;
      try {
        const judgement = judge(current.presented, current.key, response);
        const result = commitSession(active, current, judgement, clock.now(), clock);
        const attempt: Attempt = { ...result.attempt, id: `${mode}-${baseline}-${result.attempt.id}` };
        await storage.append(attempt);
        attempts = [...attempts, attempt];
        active = result.state;
        current = null;
        return judgement;
      } finally { saving = false; }
    },
    result() {
      const round = (active?.attempts ?? []).slice(mode === 'course' ? baseline : 0);
      return { completed: round.length, correct: round.filter((attempt) => attempt.judgement.correct).length,
        averageScore: round.length ? round.reduce((sum, attempt) => sum + attempt.judgement.partial, 0) / round.length : 0 };
    },
    history: () => [...attempts],
    answerName(item: NextItem): string {
      if (item.key.type === 'choice') {
        const code = item.presented.options?.[item.key.index] ?? '';
        return pilotLabels[code] ?? getSkill(item.presented.skill).label;
      }
      if (item.key.type === 'functions') return item.key.symbols.join(' → ');
      if (item.key.type === 'locations') return item.key.indices.map((index) => `第 ${index + 1} 个音符/休止位置`).join('、');
      return item.answerPitches.map((pitch) => pitch.name).join(' · ');
    },
    analyze: (samples: Float32Array, sampleRate: number, time: number): PitchFrame => estimatePitch(samples, sampleRate, time),
    segment: segmentPitchFrames,
  };
}

export type PilotStore = Awaited<ReturnType<typeof createPilotStore>>;
