import type { CacheBackend, CacheEntry } from "./types.js";

export class MemoryCacheBackend implements CacheBackend {
  private store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;

  constructor(maxEntries = Number.parseInt(process.env.CACHE_MAX_ENTRIES ?? "1000", 10)) {
    this.maxEntries = maxEntries;
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    return this.store.get(key);
  }

  async set(key: string, entry: CacheEntry, _ttlMs: number): Promise<void> {
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, entry);
  }

  async touch(key: string, entry: CacheEntry): Promise<void> {
    this.store.delete(key);
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }
}
