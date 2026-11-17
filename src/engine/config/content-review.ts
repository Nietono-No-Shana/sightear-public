import type { ContentPack } from './content-packs';
import { sourceAddressKey } from './practice-specs';

export interface CatalogContentEntry {
  address: string;
  title: string;
  moduleTitle: string;
}

export interface ContentDecision {
  address: string;
  decision: 'authored' | 'excluded' | 'blocked';
  reason: string;
  packId?: string;
  lessonId?: string;
}

export interface ContentReview {
  schemaVersion: 1;
  moduleAddress: string;
  entries: readonly ContentDecision[];
}

export function parseContentReview(value: unknown): ContentReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('expected review object');
  const review = value as ContentReview;
  if (review.schemaVersion !== 1 || typeof review.moduleAddress !== 'string' || !/^catalog:[^:]+:a\d+:m[1-9]\d*$/.test(review.moduleAddress) ||
      !Array.isArray(review.entries) || !review.entries.length || review.entries.length > 100 ||
      Object.keys(review).some((key) => !['schemaVersion', 'moduleAddress', 'entries'].includes(key))) throw new RangeError('invalid module review');
  const seen = new Set<string>();
  for (const entry of review.entries as readonly ContentDecision[]) {
    if (!entry || typeof entry.address !== 'string' || !entry.address.startsWith(`${review.moduleAddress}:l`) ||
        !/^catalog:[^:]+:a\d+:m[1-9]\d*:l[1-9]\d*$/.test(entry.address) || seen.has(entry.address) ||
        !['authored', 'excluded', 'blocked'].includes(entry.decision) || typeof entry.reason !== 'string' || !entry.reason.trim() ||
        Object.keys(entry).some((key) => !['address', 'decision', 'reason', 'packId', 'lessonId'].includes(key))) throw new RangeError('invalid or duplicate review entry');
    seen.add(entry.address);
    if (entry.decision === 'authored') {
      if (typeof entry.packId !== 'string' || !entry.packId.trim() || typeof entry.lessonId !== 'string' || !entry.lessonId.trim()) throw new RangeError('authored review requires packId and lessonId');
    } else if (entry.packId !== undefined || entry.lessonId !== undefined) throw new RangeError('unimplemented review must not claim a content lesson');
  }
  return review;
}

export function auditContentCoverage(catalog: readonly CatalogContentEntry[], reviews: readonly ContentReview[], packs: readonly ContentPack[]) {
  const expected = new Map(catalog.map((entry) => [entry.address, entry]));
  if (expected.size !== catalog.length) throw new RangeError('duplicate catalog address');
  const decisions = new Map<string, ContentDecision>();
  for (const review of reviews) for (const entry of parseContentReview(review).entries) {
    if (!expected.has(entry.address)) throw new RangeError(`unknown review address: ${entry.address}`);
    if (decisions.has(entry.address)) throw new RangeError(`duplicate review address: ${entry.address}`);
    decisions.set(entry.address, entry);
    if (entry.decision !== 'authored') continue;
    const pack = packs.find((candidate) => candidate.packId === entry.packId);
    const lesson = pack?.lessons.find((candidate) => candidate.id === entry.lessonId);
    if (!lesson?.source.address || sourceAddressKey(lesson.source.address) !== entry.address) throw new RangeError(`authored review does not resolve to matching content: ${entry.address}`);
  }
  for (const pack of packs) for (const lesson of pack.lessons) {
    if (!lesson.source.address) continue;
    const address = sourceAddressKey(lesson.source.address);
    const entry = expected.get(address);
    if (!entry || lesson.source.catalogTitle !== entry.title) throw new RangeError(`content catalog address/title mismatch: ${address}`);
    const decision = decisions.get(address);
    if (decision && (decision.decision !== 'authored' || decision.packId !== pack.packId || decision.lessonId !== lesson.id)) throw new RangeError(`content contradicts review: ${address}`);
  }
  const rows = catalog.map((entry) => ({ ...entry, ...(decisions.get(entry.address) ?? { decision: 'pending' as const }) }));
  return { total: rows.length,
    authored: rows.filter((row) => row.decision === 'authored').length,
    excluded: rows.filter((row) => row.decision === 'excluded').length,
    blocked: rows.filter((row) => row.decision === 'blocked').length,
    pending: rows.filter((row) => row.decision === 'pending').length, rows };
}
