import type { ExerciseKind, ExerciseSpec, Lesson, PerformancePolicy, Score, ScoreGeneratorSpec } from '../ports';
import { diatonicChord, durationTicks, makeInterval, midiToName, parsePitchName, scoreTimeline } from '../theory';
import { EXERCISE_DOMAINS, exerciseSkillId } from './skills';
import { rhythmBlocks, validateAdvancedGeneration } from './generation-rules';
import { resolveHarmonyStep } from './harmony';

export function validatePerformancePolicy(policy: PerformancePolicy): void {
  if (policy.grading !== undefined && policy.grading !== 'graded-v1' && policy.grading !== 'graded-v2') throw new RangeError('invalid performance grading');
  for (const tolerance of [policy.onsetMs, policy.durationMs, policy.pitchCents]) {
    if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('invalid performance tolerance');
  }
  if (!Number.isFinite(policy.latencyMs) || Math.abs(policy.latencyMs) > 2_000 || typeof policy.alignStart !== 'boolean') throw new RangeError('invalid performance alignment');
}

function pitches(values: readonly number[]): void {
  if (values.length === 0 || values.length > 128 || new Set(values).size !== values.length ||
      values.some((midi) => !Number.isInteger(midi) || midi < 0 || midi > 127)) throw new RangeError('invalid material pitches');
}

export function validateExerciseSpec(spec: ExerciseSpec): void {
  exerciseSkillId(spec.kind);
  if (!spec.id.trim() || !spec.title.trim() || spec.version !== 1 || !Number.isFinite(spec.itemRating) ||
      !Number.isInteger(spec.questionCount) || spec.questionCount < 1 || spec.questionCount > 100) throw new RangeError('invalid exercise identity');
  if (!Number.isFinite(spec.tempoBpm) || spec.tempoBpm <= 0 || spec.tempoBpm > 400) throw new RangeError('invalid exercise tempo');
  validatePerformancePolicy(spec.policy);
  if (spec.kind === 'harmony-progression') return validateHarmony(spec);
  if (spec.kind === 'interval-singing') return validateSingingIntervals(spec);
  if ('generator' in spec && spec.generator) {
    if (spec.scores.length !== 0) throw new RangeError('generated exercises must not include static score material');
    validateScoreGenerator(spec.generator, spec.kind, spec.tempoBpm, spec.correctionShiftTicks);
  } else {
    if (!spec.scores?.length || spec.scores.length > 64) throw new RangeError('missing or excessive score material');
    for (const score of spec.scores) {
      const timeline = scoreTimeline(score, spec.tempoBpm);
      if (!timeline.notes.length || timeline.size > 256) throw new RangeError('score requires 1–256 sounding events');
      if (spec.kind === 'rhythm-correction') {
        const shift = spec.correctionShiftTicks;
        if (!Number.isInteger(shift) || shift === undefined || shift <= 0 ||
            !timeline.notes.some((note, index) => index > 0 && note.dur > shift * 60_000 / spec.tempoBpm / 480)) throw new RangeError('invalid correction shift');
      }
    }
  }
}

export function validateScoreGenerator(generator: ScoreGeneratorSpec, kind: ExerciseKind, tempoBpm: number, correctionShiftTicks?: number): void {
  if (!generator || typeof generator !== 'object') throw new RangeError('expected generator object');
  const allowed = ['kind', 'version', 'clef', 'key', 'time', 'measures', 'durations', 'restProbability',
    ...(generator.version >= 2 ? ['ties'] : []),
    ...(generator.version === 3 ? ['patterns', 'required', ...(generator.kind === 'diatonic-melody' ? ['melody'] : [])] : []),
    ...(generator.kind === 'diatonic-melody' ? ['pitchRange', 'maxLeapSemitones'] : [])];
  if (Object.keys(generator).some((key) => !allowed.includes(key))) throw new RangeError('unsupported generator field');
  if (!generator.key || !generator.time ||
      Object.keys(generator.key).some((key) => !['tonic', 'mode', 'fifths'].includes(key)) ||
      Object.keys(generator.time).some((key) => !['beats', 'unit'].includes(key))) throw new RangeError('invalid generator key or time');
  const rhythmKind = kind.startsWith('rhythm-');
  if (![1, 2, 3].includes(generator.version) || !['rhythm-grid', 'diatonic-melody'].includes(generator.kind) ||
      (rhythmKind && generator.kind !== 'rhythm-grid') || (!rhythmKind && generator.kind !== 'diatonic-melody') ||
      (kind === 'rhythm-correction' && (!Number.isInteger(correctionShiftTicks) || correctionShiftTicks === undefined || correctionShiftTicks <= 0))) {
    throw new RangeError('generator kind does not match exercise kind');
  }
  if (!['treble', 'bass', 'grand'].includes(generator.clef) || !Number.isInteger(generator.measures) || generator.measures < 1 || generator.measures > 64 ||
      !Number.isInteger(generator.time.beats) || generator.time.beats < 1 || generator.time.beats > 32 || !(generator.version === 3 ? [2, 4, 8] : [4, 8]).includes(generator.time.unit) ||
      !Number.isInteger(generator.key.tonic) || generator.key.tonic < 0 || generator.key.tonic > 11 ||
      !Number.isInteger(generator.key.fifths) || Math.abs(generator.key.fifths) > 7 || !['major', 'minor'].includes(generator.key.mode) ||
      ((7 * generator.key.fifths - (generator.key.mode === 'minor' ? 3 : 0)) % 12 + 12) % 12 !== generator.key.tonic ||
      !Number.isInteger(generator.restProbability) || generator.restProbability < 0 || generator.restProbability > 80 ||
      !Array.isArray(generator.durations) || generator.durations.length < (generator.version === 3 && generator.patterns ? 0 : 1) || generator.durations.length > (generator.version === 1 ? 5 : 20)) {
    throw new RangeError('invalid score generator settings');
  }
  const durationKeys = new Set<string>();
  generator.durations.forEach((duration) => {
    if (!duration || Object.keys(duration).some((key) => !(generator.version === 1 ? ['value', 'dots'] : ['value', 'dots', 'tuplet']).includes(key))) throw new RangeError('unsupported generator duration field');
    const key = `${duration.value}:${duration.dots}:${duration.tuplet ? 'triplet' : 'ordinary'}`;
    if (generator.version < 3 && duration.value === 32) throw new RangeError('32nd notes require generator v3');
    if (durationKeys.has(key) || (generator.version === 1 && (duration.dots !== 0 || duration.tuplet !== undefined))) throw new RangeError('generator requires unique durations; v1 requires undotted, non-tuplet durations');
    if (duration.tuplet !== undefined && (!duration.tuplet || duration.dots !== 0 || duration.tuplet.actual !== 3 || duration.tuplet.normal !== 2 ||
        Object.keys(duration.tuplet).some((key) => !['actual', 'normal'].includes(key)))) throw new RangeError('generator supports only undotted 3:2 triplet groups');
    durationKeys.add(key);
    const value = durationTicks(duration);
    if (!Number.isSafeInteger(value)) throw new RangeError('generator duration must resolve to integral ticks');
  });
  if (generator.version === 3) validateAdvancedGeneration(generator);
  const blocks = rhythmBlocks(generator);
  const noteTicks = blocks.flatMap((block) => block.notes.map((note) => durationTicks(note.duration)));
  const measureTicks = 1920 * generator.time.beats / generator.time.unit;
  const groupTicks = blocks.map((block) => block.ticks);
  const reachable = new Set([0]);
  for (let cursor = 0; cursor <= measureTicks; cursor += 1) {
    if (reachable.has(cursor)) for (const length of groupTicks) if (cursor + length <= measureTicks) reachable.add(cursor + length);
  }
  const eventBound = Math.floor(measureTicks / Math.min(...noteTicks)) * generator.measures;
  if (!Number.isInteger(measureTicks) || eventBound > 256 || !reachable.has(measureTicks)) {
    throw new RangeError('generator durations cannot produce bounded complete measures');
  }
  if (generator.ties !== undefined) {
    const ties = generator.ties;
    if (!ties || Object.keys(ties).some((key) => !['withinMeasureProbability', 'acrossMeasureProbability'].includes(key)) ||
        [ties.withinMeasureProbability, ties.acrossMeasureProbability].some((value) => !Number.isInteger(value) || value < 0 || value > 100)) {
      throw new RangeError('tie probabilities must be integers in 0..100');
    }
  }
  if (['rhythm-reading', 'rhythm-imitation', 'melody-singing', 'melody-imitation'].includes(kind) &&
      Math.min(...noteTicks) * 60_000 / 480 / tempoBpm < 90) throw new RangeError('generated note duration is below the 90ms capture minimum');
  if (generator.kind === 'diatonic-melody') {
    if (!Array.isArray(generator.pitchRange) || generator.pitchRange.length !== 2) throw new RangeError('invalid melody pitch range');
    const [low, high] = generator.pitchRange;
    if (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high > 127 || low > high || high - low > 48 ||
        !Number.isInteger(generator.maxLeapSemitones) || generator.maxLeapSemitones < 1 || generator.maxLeapSemitones > 24) {
      throw new RangeError('invalid melody pitch constraints');
    }
    const steps = generator.key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
    if (generator.version !== 3 && !Array.from({ length: high - low + 1 }, (_, index) => low + index).some((midi) => steps.some((step) => midi % 12 === (generator.key.tonic + step) % 12))) {
      throw new RangeError('melody pitch range contains no notes in the selected key');
    }
  }
  if (kind === 'rhythm-correction' && (eventBound < 2 || (!generator.ties && !noteTicks.some((duration) => duration <= measureTicks && duration > correctionShiftTicks!)))) {
    throw new RangeError('generator has no possible correction target');
  }
}

function validateHarmony(spec: Extract<ExerciseSpec, { kind: 'harmony-progression' }>): void {
  pitches(spec.tonics);
  if (spec.chordSequences !== undefined) {
    if (!['major', 'naturalMinor', 'harmonicMinor'].includes(spec.mode) || !Array.isArray(spec.sequences) || spec.sequences.length ||
        !Array.isArray(spec.chordSequences) || !spec.chordSequences.length || spec.chordSequences.length > 64) throw new RangeError('invalid extended harmony material');
    if (new Set(spec.chordSequences.map((sequence) => JSON.stringify(sequence))).size !== spec.chordSequences.length) throw new RangeError('duplicate harmony sequence');
    for (const sequence of spec.chordSequences) {
      if (!Array.isArray(sequence) || sequence.length < 2 || sequence.length > 16) throw new RangeError('invalid harmony sequence length');
      for (const tonic of spec.tonics) for (const step of sequence) resolveHarmonyStep(parsePitchName(midiToName(tonic))!, spec.mode, step);
    }
    for (const tonic of spec.tonics) {
      const signatures = new Map<string, string>();
      for (const step of spec.chordSequences.flat()) {
        const chord = resolveHarmonyStep(parsePitchName(midiToName(tonic))!, spec.mode, step);
        const signature = chord.tones.map((tone) => tone.midi).join(',');
        if (signatures.has(signature) && signatures.get(signature) !== chord.symbol) throw new RangeError('ambiguous harmony answers');
        signatures.set(signature, chord.symbol);
      }
    }
    return;
  }
  if (!['major', 'naturalMinor', 'harmonicMinor'].includes(spec.mode) || !spec.sequences.length || spec.sequences.length > 64) throw new RangeError('invalid harmony material');
  if (new Set(spec.sequences.map((sequence) => sequence.join(','))).size !== spec.sequences.length) throw new RangeError('duplicate harmony sequence');
  for (const sequence of spec.sequences) {
    if (sequence.length < 2 || sequence.length > 16 || sequence.some((degree) => !Number.isInteger(degree) || degree < 1 || degree > 7)) throw new RangeError('invalid harmony degrees');
    for (const tonic of spec.tonics) for (const degree of sequence) {
      if (!diatonicChord(parsePitchName(midiToName(tonic))!, spec.mode, degree)) throw new RangeError('unsupported diatonic harmony');
    }
  }
}

function validateSingingIntervals(spec: Extract<ExerciseSpec, { kind: 'interval-singing' }>): void {
  pitches(spec.roots);
  if (!spec.intervals.length || spec.intervals.length > 64) throw new RangeError('missing singing intervals');
  for (const interval of spec.intervals) {
    makeInterval(interval.number, interval.semitones);
    if (!['asc', 'desc'].includes(interval.direction) || interval.semitones > 24) throw new RangeError('invalid singing interval');
    for (const root of spec.roots) {
      const target = root + (interval.direction === 'asc' ? interval.semitones : -interval.semitones);
      if (target < 0 || target > 127) throw new RangeError('singing target exceeds MIDI range');
    }
  }
}

export function lessonForExercise(spec: ExerciseSpec): Lesson {
  validateExerciseSpec(spec);
  return { id: spec.id, title: spec.title, module: EXERCISE_DOMAINS[spec.kind], skills: [exerciseSkillId(spec.kind)], directions: ['asc'], source: 'custom', exerciseSpec: spec };
}

function material(midis: readonly (number | null)[], eighths = false): Score {
  return { clef: 'treble', measures: [{
    key: { tonic: 0, mode: 'major', fifths: 0 }, time: { beats: 4, unit: 4 },
    voices: [{ notes: midis.map((midi, index) => ({
      pitch: midi === null ? null : { midi, name: midiToName(midi) },
      duration: { value: eighths && (index === 1 || index === 2) ? 8 : 4, dots: 0 }, tie: false,
    })) }],
  }] };
}

const rhythm = [material([60, null, 60, 60]), material([60, 60, 60, null, 60], true)];
const melodies = [material([60, 62, 64, 60]), material([64, 65, 67, 62, 60], true)];
const titles: Readonly<Record<ExerciseKind, string>> = {
  'harmony-progression': '和声进行', 'rhythm-imitation': '节奏模仿', 'rhythm-reading': '节奏视读',
  'rhythm-correction': '节奏纠错', 'rhythm-dictation': '节奏听写', 'melody-dictation': '旋律听写',
  'interval-singing': '音程视唱', 'melody-singing': '旋律视唱', 'melody-imitation': '旋律模唱',
};

export const EXERCISE_EXAMPLES: readonly ExerciseSpec[] = (Object.keys(titles) as ExerciseKind[]).map((kind): ExerciseSpec => {
  const base = {
    id: `exercise-example:${kind}`, version: 1 as const, title: titles[kind], tempoBpm: 90, itemRating: 1100,
    questionCount: kind.includes('dictation') || kind.startsWith('melody-') ? 4 : 8,
    policy: { onsetMs: 100, durationMs: 150, pitchCents: 25, latencyMs: 0, alignStart: false, grading: 'graded-v2' as const },
  };
  if (kind === 'harmony-progression') return { ...base, kind, tonics: [48, 50], mode: 'major', sequences: [[1, 4, 5, 1], [1, 2, 5, 1]] };
  if (kind === 'interval-singing') return { ...base, kind, roots: [60, 62], intervals: [{ number: 3, semitones: 4, direction: 'asc' }, { number: 3, semitones: 3, direction: 'desc' }] };
  return { ...base, kind, scores: kind.startsWith('rhythm-') ? rhythm : melodies, ...(kind === 'rhythm-correction' ? { correctionShiftTicks: 120 } : {}) };
});
