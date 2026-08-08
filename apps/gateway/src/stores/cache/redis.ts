import type { Redis } from "@upstash/redis";
import type { CacheBackend, CacheEntry } from "./types.js";

const KEY_PREFIX = "freellm:cache:";

export class RedisCacheBackend implements CacheBackend {
  constructor(private redis: Redis) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const raw = await this.redis.get<CacheEntry>(KEY_PREFIX + key);
    return raw ?? undefined;
  }

  async set(key: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    await this.redis.set(KEY_PREFIX + key, entry, { px: Math.max(1, ttlMs) });
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + key);
  }

  async clear(): Promise<void> {
    // Best-effort no-op; full flush via Upstash console.
  }

  async size(): Promise<number> {
    return 0;
  }
}
