import type {
  AnswerKey,
  ItemFeatures,
  Pitch,
  PresentedItem,
  Rng,
  RngFactory,
  ScheduleKey,
  SkillId,
  SoundEvent,
  Score,
} from '../ports';
import { assertItemFeatures, getSkill, templateKey, skillsForPracticeSpec, practiceAnswerCodes, type ChoicePracticeSpec } from '../config';
import { comparisonContent } from './comparison';
import {
  buildChord,
  voiceChord,
  scaleNotes,
  chordToPitches,
  midiToName,
  parsePitchName,
  toPitch,
  transposeBy,
  type SpelledPitch,
} from '../theory';

const NOTE_VELOCITY = 0.8;
const REFERENCE_VELOCITY = 0.6;

export interface GeneratedItem {
  readonly answerScore?: Score;
  readonly presented: PresentedItem;
  readonly key: AnswerKey;
  readonly templateKey: string;
  readonly targets: readonly ScheduleKey[];
  /** 仅用于答后揭示；不要放进 PresentedItem。 */
  readonly answerPitches: readonly Pitch[];
}

function pickRoot(features: ItemFeatures, rng: Rng, range?: readonly [number, number]): SpelledPitch {
  const base = features.register === 'low' ? 48 : features.register === 'mid' ? 60 : 72;
  const midi = range === undefined ? base + rng.int(12) : range[0] + rng.int(range[1] - range[0] + 1);
  const parsed = parsePitchName(midiToName(midi));
  if (parsed === null) {
    throw new RangeError(`cannot spell MIDI root ${midi}`);
  }
  return parsed;
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    const current = copy[i];
    const other = copy[j];
    if (current === undefined || other === undefined) {
      throw new RangeError('shuffle index out of range');
    }
    copy[i] = other;
    copy[j] = current;
  }
  return copy;
}

function uniqueKeys(keys: readonly ScheduleKey[]): readonly ScheduleKey[] {
  return [...new Set(keys)];
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function beatMs(features: ItemFeatures): number {
  return 60_000 / features.tempoBpm;
}

function referenceEvents(
  root: SpelledPitch,
  features: ItemFeatures,
  beat: number,
): SoundEvent[] {
  if (features.reference === 'none') return [];
  const dur = Math.round(beat * 0.9);
  if (features.reference === 'tonic') {
    return [
      {
        kind: 'note',
        midi: root.midi,
        velocity: REFERENCE_VELOCITY,
        start: 0,
        dur,
        timbre: features.timbre,
      },
    ];
  }
  const chord = buildChord(root, 'major');
  return [
    {
      kind: 'chord',
      midis: chord.map((tone) => tone.midi),
      start: 0,
      dur,
      timbre: features.timbre,
    },
  ];
}

function intervalEvents(
  root: SpelledPitch,
  target: SpelledPitch,
  features: ItemFeatures,
  start: number,
  beat: number,
): SoundEvent[] {
  if (features.direction === 'harmonic') {
    return [
      {
        kind: 'chord',
        midis: [root.midi, target.midi],
        start,
        dur: Math.round(beat * 1.8),
        timbre: features.timbre,
      },
    ];
  }

  const order = features.direction === 'desc' ? [target, root] : [root, target];
  return order.map((pitch, index) => ({
    kind: 'note' as const,
    midi: pitch.midi,
    velocity: NOTE_VELOCITY,
    start: start + Math.round(index * beat),
    dur: Math.round(beat * 0.9),
    timbre: features.timbre,
  }));
}

function chordEvents(
  tones: readonly SpelledPitch[],
  features: ItemFeatures,
  start: number,
  beat: number,
): SoundEvent[] {
  if (features.direction === 'harmonic') {
    return [
      {
        kind: 'chord',
        midis: tones.map((tone) => tone.midi),
        start,
        dur: Math.round(beat * 1.8),
        timbre: features.timbre,
      },
    ];
  }

  const order = features.direction === 'desc' ? [...tones].reverse() : [...tones];
  const step = Math.round(beat * 0.5);
  const dur = Math.round(beat * 0.45);
  return order.map((tone, index) => ({
    kind: 'note' as const,
    midi: tone.midi,
    velocity: NOTE_VELOCITY,
    start: start + index * step,
    dur,
    timbre: features.timbre,
  }));
}

export function generate(
  skill: SkillId,
  features: ItemFeatures,
  seed: number,
  rngFactory: RngFactory,
  optionCodes?: readonly string[],
  spec?: ChoicePracticeSpec,
): GeneratedItem {
  if (spec !== undefined) {
    if (!skillsForPracticeSpec(spec).includes(skill)) throw new RangeError('skill outside practice spec');
    features = {
      ...features, register: spec.stimulus.rootMidi[0] < 60 ? 'low' : spec.stimulus.rootMidi[0] < 72 ? 'mid' : 'high',
      direction: spec.stimulus.direction, reference: spec.stimulus.reference, tempoBpm: spec.stimulus.tempoBpm,
    };
    optionCodes = practiceAnswerCodes(spec.task);
  }
  assertItemFeatures(features);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError(`seed must be a non-negative safe integer, got ${seed}`);
  }

  const meta = getSkill(skill);
  const itemRng = rngFactory.fromSeed(seed);
  const root = pickRoot(features, itemRng, spec?.stimulus.rootMidi);
  const beat = beatMs(features);
  const reference = referenceEvents(root, features, beat);
  const start = reference.length === 0 ? 0 : Math.round(beat * 1.5);

  let content: readonly SoundEvent[];
  let answerPitches: readonly Pitch[];
  if (meta.kind === 'interval') {
    const target = transposeBy(root, meta.intervalNumber, meta.semitones);
    content = intervalEvents(root, target, features, start, beat);
    answerPitches = [toPitch(root), toPitch(target)];
  } else if (meta.kind === 'interval-comparison') {
    const comparison = comparisonContent(root, meta, features, itemRng, spec);
    content = comparison.content;
    answerPitches = comparison.answerPitches;
  } else if (meta.kind === 'chord-inversion') {
    const tones = buildChord(root, meta.quality, meta.inversion);
    content = chordEvents(tones, features, start, beat);
    answerPitches = chordToPitches(tones);
  } else if (meta.kind === 'scale') {
    if (features.direction === 'harmonic') throw new RangeError('scale requires melodic direction');
    const tones = scaleNotes(root, meta.mode);
    const ordered = features.direction === 'desc' ? [...tones].reverse() : tones;
    content = ordered.map((tone, index) => ({
      kind: 'note', midi: tone.midi, velocity: NOTE_VELOCITY,
      start: start + Math.round(index * beat), dur: Math.round(beat * 0.9), timbre: features.timbre,
    }));
    answerPitches = ordered;
  } else if (meta.kind === 'chord') {
    const tones = voiceChord(root, meta.quality, spec?.task.kind === 'chord-identification' ? spec.task.voicing : undefined);
    content = chordEvents(tones, features, start, beat);
    answerPitches = chordToPitches(tones);
  } else {
    throw new RangeError('unsupported skill kind');
  }

  const options = shuffled(
    optionCodes === undefined ? meta.options : [...new Set(optionCodes)],
    itemRng,
  );
  if (options.length === 0) {
    throw new RangeError(`empty option set for ${skill}`);
  }
  const index = options.indexOf(meta.code);
  if (index < 0) {
    throw new RangeError(`option set for ${skill} does not contain ${meta.code}`);
  }

  const template = templateKey(skill, features) + (spec === undefined ? '' : `|${spec.id}@${spec.version}|${JSON.stringify([spec.task, spec.stimulus, spec.scoring])}`);
  const targets = uniqueKeys([skill, ...meta.pairs]);
  const presented: PresentedItem = {
    id: `${skill}#${shortHash(template)}#${seed}`,
    templateKey: template,
    skill,
    kind: 'identify',
    seed,
    features,
    targets,
    schemaVersion: 1,
    score: null,
    stimulus: [...reference, ...content],
    options,
    prompt:
      meta.kind === 'interval'
        ? '识别音程'
        : meta.kind === 'chord-inversion'
          ? '识别和弦转位'
          : meta.kind === 'scale' ? '识别音阶' : meta.kind === 'interval-comparison' ? '比较音程 A 与 B 的大小' : '识别和弦',
  };

  return {
    presented,
    key: { type: 'choice', index },
    templateKey: template,
    targets,
    answerPitches,
  };
}
