import { readFileSync } from 'node:fs';
import { parseContentPack, EXERCISE_EXAMPLES, INITIAL_PRACTICE_SPECS, type ContentPack } from '@engine/config';

const sample = JSON.parse(readFileSync('content/packs/rhythm-reading-sample.json', 'utf8')) as unknown;

function packWith(spec: ContentPack['lessons'][number]['spec'], id = spec.id): unknown {
  return {
    schemaVersion: 1, packId: 'test.pack', revision: '1.0.0', title: 'Test pack',
    lessons: [{ id, order: 1, source: { address: null, catalogTitle: null, evidence: 'local-design', note: 'Test material.' }, spec }],
  };
}

describe('versioned content packs', () => {
  it('parses the checked-in authoring example and preserves its discriminated spec', () => {
    const parsed = parseContentPack(sample);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.lessons[0]?.spec && 'kind' in parsed.lessons[0].spec ? parsed.lessons[0].spec.kind : null).toBe('rhythm-reading');
    expect(parsed.lessons[0]?.source.evidence).toBe('local-design');
  });

  it.each(INITIAL_PRACTICE_SPECS)('accepts existing choice content: $id', (spec) => {
    expect(() => parseContentPack(packWith(spec))).not.toThrow();
  });

  it.each(EXERCISE_EXAMPLES)('accepts supported exercise material: $kind', (spec) => {
    expect(() => parseContentPack(packWith({ ...spec, id: 'test.lesson' }))).not.toThrow();
  });

  it('accepts a versioned generated-score rule in a content pack', () => {
    const base = EXERCISE_EXAMPLES.find((spec) => spec.kind === 'rhythm-reading');
    if (!base || base.kind !== 'rhythm-reading') throw new Error('missing rhythm-reading example');
    const spec = {
      ...base, id: 'test.generated', scores: [], generator: {
        kind: 'rhythm-grid' as const, version: 1 as const, clef: 'treble' as const,
        key: { tonic: 0, mode: 'major' as const, fifths: 0 }, time: { beats: 4, unit: 4 as const },
        measures: 4, durations: [{ value: 2 as const, dots: 0 as const }, { value: 4 as const, dots: 0 as const }, { value: 8 as const, dots: 0 as const }],
        restProbability: 10,
      },
    };
    expect(parseContentPack(packWith(spec)).lessons[0]?.spec).toMatchObject({ id: 'test.generated', generator: { kind: 'rhythm-grid', version: 1 } });
  });

  it('rejects unsupported format, duplicate ids/orders/sources and mismatched spec identity', () => {
    const base = parseContentPack(sample);
    expect(() => parseContentPack({ ...base, schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => parseContentPack({ ...base, lessons: [base.lessons[0], { ...base.lessons[0], order: 2 }] })).toThrow(/duplicate lesson id/);
    const catalogSource = { address: { courseId: 'catalog:Std', activity: 8, module: 1, lesson: 1 }, catalogTitle: 'Scale lesson', evidence: 'catalog-only', note: 'Catalog address verified.' };
    const first = { ...base.lessons[0]!, source: catalogSource };
    expect(() => parseContentPack({ ...base, lessons: [first, { ...first, id: 'other', order: 2, spec: { ...first.spec, id: 'other' } }] })).toThrow(/duplicate source/);
    expect(() => parseContentPack(packWith(base.lessons[0]!.spec, 'different-id'))).toThrow(/must match lesson id/);
    expect(() => parseContentPack({ ...base, extra: true })).toThrow(/unsupported field extra/);
    expect(() => parseContentPack({ ...base, lessons: [{ ...base.lessons[0], order: 2 }] })).toThrow(/contiguous/);
  });

  it('keeps framework-owned grading and difficulty fixed and rejects too-short sung notes', () => {
    const melody = EXERCISE_EXAMPLES.find((spec) => spec.kind === 'melody-singing');
    if (!melody || melody.kind === 'harmony-progression' || melody.kind === 'interval-singing') throw new Error('missing melody spec');
    expect(() => parseContentPack(packWith({ ...melody, id: 'test.lesson', itemRating: 1200 }))).toThrow(/framework-managed/);
    expect(() => parseContentPack(packWith({ ...melody, id: 'test.lesson', policy: { ...melody.policy, pitchCents: 40 } }))).toThrow(/framework-managed/);
    const short = { ...melody, id: 'test.lesson', tempoBpm: 200, scores: melody.scores.map((score) => ({
      ...score, measures: score.measures.map((measure) => ({ ...measure,
        time: { beats: 4, unit: 4 as const },
        voices: [{ notes: Array.from({ length: 16 }, () => ({ pitch: { midi: 60, name: 'C4' }, duration: { value: 16 as const, dots: 0 as const }, tie: false })) }],
      })),
    })) };
    expect(() => parseContentPack(packWith(short))).toThrow(/90ms/);
  });
});
