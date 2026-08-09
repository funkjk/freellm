import type { Redis } from "@upstash/redis";
import type { RequestLogEntry } from "../../types.js";
import type { RequestLogStore } from "./types.js";

const LIST_KEY = "freellm:requestlog";

export class RedisRequestLogStore implements RequestLogStore {
  private readonly maxEntries: number;

  constructor(
    private redis: Redis,
    maxEntries = 500,
  ) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  async append(entry: RequestLogEntry): Promise<void> {
    await this.redis.lpush(LIST_KEY, JSON.stringify(entry));
    await this.redis.ltrim(LIST_KEY, 0, this.maxEntries - 1);
  }

  async getRecent(limit: number): Promise<RequestLogEntry[]> {
    const n = Math.max(0, limit);
    if (n === 0) return [];
    const raw = (await this.redis.lrange(LIST_KEY, 0, n - 1)) ?? [];
    const out: RequestLogEntry[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      try {
        out.push(JSON.parse(item) as RequestLogEntry);
      } catch {
        // skip corrupt entries
      }
    }
    return out;
  }

  async clear(): Promise<void> {
    await this.redis.del(LIST_KEY);
  }
}
