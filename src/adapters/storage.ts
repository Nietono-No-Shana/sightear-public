import type { Attempt, Storage as AttemptStorage } from '../engine/ports';

const STORAGE_KEY = 'sightear.attempts.v2';

export class LocalStorageAttempts implements AttemptStorage {
  constructor(private readonly key: string = STORAGE_KEY) {}
  private readSync(): readonly Attempt[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Attempt[]) : [];
    } catch {
      return [];
    }
  }

  private writeSync(attempts: readonly Attempt[]): void {
    localStorage.setItem(this.key, JSON.stringify(attempts));
  }

  async loadAll(): Promise<readonly Attempt[]> {
    return this.readSync();
  }

  async append(attempt: Attempt): Promise<void> {
    const attempts = this.readSync();
    this.writeSync([...attempts, attempt]);
  }

  async exportJson(): Promise<string> {
    return JSON.stringify(this.readSync());
  }

  clear(): void {
    localStorage.removeItem(this.key);
  }
}
