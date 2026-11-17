import type { AnswerKey, ExerciseSpec, ItemKind, NoteEvent, Pitch, PresentedItem, Rng, RngFactory, Score, SoundEvent, TimbreId } from '../ports';
import { exerciseSkillId, validateExerciseSpec, resolveHarmonyStep } from '../config';
import { diatonicChord, makeInterval, midiToName, midiToPitch, parsePitchName, scoreTimeline } from '../theory';
import { generateScore } from './generators';
import type { GeneratedItem } from './generate';

interface Content {
  notationContext?: NonNullable<PresentedItem['notationContext']>;
  key: AnswerKey;
  kind: ItemKind;
  score: Score | null;
  stimulus: readonly SoundEvent[] | null;
  options: readonly string[] | null;
  prompt: string;
  answerPitches: readonly Pitch[];
  answerScore?: Score;
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function pick<Value>(values: readonly Value[], rng: Rng): Value {
  const selected = values[rng.int(values.length)];
  if (selected === undefined) throw new RangeError('empty exercise material');
  return selected;
}

function audio(notes: readonly NoteEvent[], timbre: TimbreId): readonly SoundEvent[] {
  return notes.map((note) => ({ kind: 'note', midi: note.midi, start: note.start, dur: note.dur, velocity: 0.8, timbre }));
}

function symbol(degree: number, quality: string): string {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][degree - 1]!;
  if (quality === 'diminished') return `${roman.toLowerCase()}°`;
  if (quality === 'augmented') return `${roman}+`;
  return quality === 'minor' ? roman.toLowerCase() : roman;
}

function harmony(spec: Extract<ExerciseSpec, { kind: 'harmony-progression' }>, rng: Rng, timbre: TimbreId): Content {
  if (spec.chordSequences) return extendedHarmony(spec, rng, timbre);
  const tonic = parsePitchName(midiToName(pick(spec.tonics, rng)))!;
  const sequence = pick(spec.sequences, rng);
  const chords = sequence.map((degree) => diatonicChord(tonic, spec.mode, degree)!);
  const beat = 60_000 / spec.tempoBpm;
  const vocabulary = [...new Set(spec.sequences.flat())].map((degree) => symbol(degree, diatonicChord(tonic, spec.mode, degree)!.quality));
  return {
    kind: 'identify', key: { type: 'functions', symbols: chords.map((chord, index) => symbol(sequence[index]!, chord.quality)) },
    score: null, options: vocabulary, prompt: `${tonic.name} · ${spec.mode} · 按顺序填写 ${sequence.length} 个和弦功能`,
    stimulus: chords.map((chord, index) => ({ kind: 'chord', midis: chord.tones.map((tone) => tone.midi), start: index * 2 * beat, dur: beat * 1.8, timbre })),
    answerPitches: chords.flatMap((chord) => chord.tones.map((tone) => ({ midi: tone.midi, name: tone.name }))),
  };
}

function extendedHarmony(spec: Extract<ExerciseSpec, { kind: 'harmony-progression' }>, rng: Rng, timbre: TimbreId): Content {
  const tonic = parsePitchName(midiToName(pick(spec.tonics, rng)))!;
  const chords = pick(spec.chordSequences!, rng).map((step) => resolveHarmonyStep(tonic, spec.mode, step));
  const vocabulary = [...new Set(spec.chordSequences!.flat().map((step) => resolveHarmonyStep(tonic, spec.mode, step).symbol))];
  const beat = 60_000 / spec.tempoBpm;
  return {
    kind: 'identify', key: { type: 'functions', symbols: chords.map((chord) => chord.symbol) },
    score: null, options: vocabulary, prompt: `${tonic.name} · ${spec.mode} · 按顺序选择级数与和弦类型`,
    stimulus: chords.map((chord, index) => ({ kind: 'chord', midis: chord.tones.map((tone) => tone.midi), start: index * 2 * beat, dur: beat * 1.8, timbre })),
    answerPitches: chords.flatMap((chord) => chord.tones.map((tone) => ({ midi: tone.midi, name: tone.name }))),
  };
}

function singingInterval(spec: Extract<ExerciseSpec, { kind: 'interval-singing' }>, rng: Rng, timbre: TimbreId): Content {
  const root = pick(spec.roots, rng);
  const interval = pick(spec.intervals, rng);
  const target = root + (interval.direction === 'asc' ? interval.semitones : -interval.semitones);
  const note = { midi: target, start: 0, dur: 60_000 / spec.tempoBpm, cents: 0 };
  return {
    kind: 'sight', score: null, options: null,
    prompt: `演唱 ${makeInterval(interval.number, interval.semitones).label} · ${interval.direction === 'asc' ? '上行' : '下行'}`,
    key: { type: 'performance', mode: 'sung', notes: [note], end: note.dur, tempoBpm: spec.tempoBpm, rhythmOnly: false, timing: 'none', policy: { ...spec.policy } },
    stimulus: audio([{ ...note, midi: root }], timbre), answerPitches: [midiToPitch(target)],
  };
}

function copyScore(score: Score, rhythmOnly: boolean): Score {
  return { ...score, measures: score.measures.map((measure) => ({
    ...measure, key: { ...measure.key }, time: { ...measure.time },
    voices: measure.voices.map((voice) => ({ notes: voice.notes.map((note) => ({
      ...note, pitch: note.pitch === null ? null : rhythmOnly ? midiToPitch(60) : { ...note.pitch },
      duration: { ...note.duration, ...(note.duration.tuplet ? { tuplet: { ...note.duration.tuplet } } : {}) },
    })) })),
  })) };
}

function scoreContent(spec: Exclude<ExerciseSpec, { kind: 'harmony-progression' | 'interval-singing' }>, rng: Rng, timbre: TimbreId): Content {
  const rhythmOnly = spec.kind.startsWith('rhythm-');
  const sourceScore = spec.generator
    ? generateScore(spec.generator, rng.fork('generated-score'), spec.kind === 'rhythm-correction' ? spec.correctionShiftTicks : undefined)
    : pick(spec.scores, rng);
  const score = copyScore(sourceScore, rhythmOnly);
  const timeline = scoreTimeline(score, spec.tempoBpm);
  const notes = timeline.notes.map(({ midi, start, dur, cents }) => ({ midi, start, dur, cents }));
  const answerPitches = notes.map((note) => midiToPitch(note.midi));
  const firstMeasure = score.measures[0]!;
  const notationContext = { key: { ...firstMeasure.key }, time: { ...firstMeasure.time }, measures: score.measures.length };
  if (spec.kind === 'rhythm-correction') {
    const shift = spec.correctionShiftTicks! * 60_000 / spec.tempoBpm / 480;
    const index = pick(notes.map((note, index) => ({ note, index })).filter(({ note, index }) => index > 0 && note.dur > shift), rng).index;
    const changed = notes.map((note, position) => position === index ? { ...note, start: note.start + shift, dur: note.dur - shift } : note);
    return { kind: 'detect', score, answerScore: copyScore(score, false), answerPitches, options: null, notationContext,
      prompt: '指出谱面中与播放节奏不同的位置', stimulus: audio(changed, timbre),
      key: { type: 'locations', indices: [timeline.notes[index]!.scoreIndex], size: timeline.size } };
  }
  const notation = spec.kind === 'rhythm-dictation' || spec.kind === 'melody-dictation';
  const reading = spec.kind === 'rhythm-reading' || spec.kind === 'melody-singing';
  const mode = notation ? 'notation' : rhythmOnly ? 'tapped' : 'sung';
  const policy = notation ? { onsetMs: 0, durationMs: 0, pitchCents: 0, latencyMs: 0, alignStart: false } : { ...spec.policy };
  const stimulus = reading ? (rhythmOnly ? null : audio([{ ...notes[0]!, start: 0, dur: 60_000 / spec.tempoBpm }], timbre)) : audio(notes, timbre);
  return {
    kind: notation ? 'dictation' : rhythmOnly ? 'tap' : reading ? 'sight' : 'audiation',
    score: reading ? copyScore(score, false) : null, stimulus, options: null,
    prompt: `${spec.title} · ${spec.tempoBpm} BPM`, answerScore: score, answerPitches, notationContext,
    key: { type: 'performance', mode, notes, tempoBpm: spec.tempoBpm, end: timeline.end, rhythmOnly,
      timing: mode === 'tapped' ? 'onset' : 'full', policy },
  };
}

export function generateExercise(spec: ExerciseSpec, seed: number, rngFactory: RngFactory, timbre: TimbreId = 'piano'): GeneratedItem {
  validateExerciseSpec(spec);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError('invalid exercise seed');
  if (!['piano', 'strings', 'synth', 'organ'].includes(timbre)) throw new RangeError('invalid exercise timbre');
  const rng = rngFactory.fromSeed(seed);
  const content = spec.kind === 'harmony-progression' ? harmony(spec, rng, timbre)
    : spec.kind === 'interval-singing' ? singingInterval(spec, rng, timbre) : scoreContent(spec, rng, timbre);
  const skill = exerciseSkillId(spec.kind);
  const template = `exercise-v1|${spec.id}@${spec.version}|${fingerprint(JSON.stringify(spec))}|${timbre}`;
  const time = content.notationContext?.time ?? { beats: 4, unit: 4 };
  const beat = 60_000 / spec.tempoBpm * 4 / time.unit;
  const inputLeadIn: SoundEvent[] = content.key.type === 'performance' && content.key.mode !== 'notation'
    ? Array.from({ length: time.beats }, (_, index) => ({ kind: 'click', start: index * beat, accent: index === 0 })) : [];
  return {
    presented: {
      id: `${template}#${seed}`, templateKey: template, skill, kind: content.kind, seed, schemaVersion: 1,
      features: { register: 'mid', direction: 'asc', reference: 'none', timbre, tempoBpm: spec.tempoBpm, voices: 1, bars: content.answerScore?.measures.length ?? 1, chunk: 1 },
      targets: [skill], score: content.score, stimulus: content.stimulus, options: content.options, prompt: content.prompt,
      exerciseKind: spec.kind, inputLeadIn, inputLeadInMs: inputLeadIn.length * beat,
      ...(content.notationContext ? { notationContext: content.notationContext } : {}),
    },
    key: content.key, targets: [skill], templateKey: template, answerPitches: content.answerPitches,
    ...(content.answerScore ? { answerScore: content.answerScore } : {}),
  };
}
