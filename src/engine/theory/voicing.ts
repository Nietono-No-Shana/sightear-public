import type { ChordVoicing } from '../ports';
import { buildChord, CHORD_DEFINITIONS, type ChordQuality } from './chord';
import { makeSpelled, type SpelledPitch } from './pitch';

export function voiceChord(root: SpelledPitch, quality: ChordQuality, voicing?: ChordVoicing): readonly SpelledPitch[] {
  if (voicing === undefined) return buildChord(root, quality);
  const definition = CHORD_DEFINITIONS.find((entry) => entry.quality === quality);
  if (!definition || !voicing || Object.keys(voicing).some((key) => !['bassDegree', 'omitDegrees', 'spread'].includes(key)) ||
      !['stacked', 'open'].includes(voicing.spread) || !Array.isArray(voicing.omitDegrees) ||
      new Set(voicing.omitDegrees).size !== voicing.omitDegrees.length) throw new RangeError('invalid chord voicing');
  const degrees = definition.tones.map((tone) => tone.number);
  if (!degrees.includes(voicing.bassDegree) || voicing.omitDegrees.some((degree) => !degrees.includes(degree) || ![5, 9, 11].includes(degree)) ||
      voicing.omitDegrees.includes(voicing.bassDegree) || voicing.omitDegrees.includes(Math.max(...degrees))) throw new RangeError('voicing removes a required chord tone');
  if (voicing.omitDegrees.some((degree) => definition.tones.find((tone) => tone.number === degree)!.semitones !== ({ 5: 7, 9: 14, 11: 17 } as Record<number, number>)[degree])) throw new RangeError('cannot omit altered chord tones');
  const tones = buildChord(root, quality);
  const bass = tones[degrees.indexOf(voicing.bassDegree)]!;
  const upper = tones.filter((_, index) => degrees[index] !== voicing.bassDegree && !voicing.omitDegrees.includes(degrees[index]!));
  const voiced = upper.map((tone, index) => {
    const octaves = Math.max(0, Math.floor((bass.midi - tone.midi) / 12) + 1) + (voicing.spread === 'open' && index % 2 === 1 ? 1 : 0);
    return makeSpelled(tone.letter, tone.accidental, tone.octave + octaves);
  });
  return [bass, ...voiced.sort((left, right) => left.midi - right.midi)];
}
