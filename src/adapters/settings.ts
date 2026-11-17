import type { TimbreId, VocalRangeId, VocalBounds } from '../engine/ports';

const STORAGE_KEY = 'sightear.settings.v1';
const DEFAULT_TIMBRE: TimbreId = 'piano';
const TIMBRES: readonly TimbreId[] = ['piano', 'strings', 'synth', 'organ'];

export interface AppSettings {
  timbre: TimbreId;
  vocalRange: VocalRangeId;
  vocalBounds?: VocalBounds;
}

function isTimbre(value: unknown): value is TimbreId {
  return typeof value === 'string' && TIMBRES.includes(value as TimbreId);
}

export class LocalSettings {
  load(): AppSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return { timbre: DEFAULT_TIMBRE, vocalRange: 'original' };
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return { timbre: DEFAULT_TIMBRE, vocalRange: 'original' };
      const timbre = (parsed as { timbre?: unknown }).timbre;
      const voice = (parsed as { vocalRange?: unknown }).vocalRange;
      const vocalRange = typeof voice === 'string' && ['original', 'soprano', 'mezzo', 'alto', 'tenor', 'baritone', 'bass'].includes(voice)
        ? voice as VocalRangeId : 'original';
      const bounds = (parsed as { vocalBounds?: { low?: unknown; high?: unknown } }).vocalBounds;
      const validBounds = bounds && typeof bounds.low === 'number' && typeof bounds.high === 'number'
        && Number.isInteger(bounds.low) && Number.isInteger(bounds.high) && bounds.low >= 0 && bounds.high <= 127 && bounds.low < bounds.high;
      return { timbre: isTimbre(timbre) ? timbre : DEFAULT_TIMBRE, vocalRange,
        ...(validBounds ? { vocalBounds: { low: bounds.low as number, high: bounds.high as number } } : {}) };
    } catch {
      return { timbre: DEFAULT_TIMBRE, vocalRange: 'original' };
    }
  }

  save(settings: AppSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 设置持久化失败不应阻断练习；下一次读取会退回默认值。
    }
  }
}
