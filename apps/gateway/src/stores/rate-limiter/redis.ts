import type { Redis } from "@upstash/redis";
import { windowConfigFor } from "./memory.js";
import type { RateLimiterStore, WindowStats } from "./types.js";

const WINDOW_PREFIX = "freellm:rl:w:";
const COOLDOWN_PREFIX = "freellm:rl:cd:";

export class RedisRateLimiterStore implements RateLimiterStore {
  constructor(private redis: Redis) {}

  async recordRequest(trackingId: string): Promise<void> {
    const now = Date.now();
    const cfg = windowConfigFor(trackingId);
    const key = WINDOW_PREFIX + trackingId;
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    await this.redis.zadd(key, { score: now, member });
    await this.redis.zremrangebyscore(key, 0, now - cfg.windowMs);
    await this.redis.pexpire(key, cfg.windowMs);
  }

  async isRateLimited(trackingId: string): Promise<boolean> {
    const cd = await this.redis.get<string>(COOLDOWN_PREFIX + trackingId);
    if (cd != null) {
      const blockedUntil = Number(cd);
      if (Number.isFinite(blockedUntil) && Date.now() < blockedUntil) return true;
      await this.redis.del(COOLDOWN_PREFIX + trackingId);
    }
    return this.isWindowFull(trackingId);
  }

  private async isWindowFull(trackingId: string): Promise<boolean> {
    const now = Date.now();
    const cfg = windowConfigFor(trackingId);
    const key = WINDOW_PREFIX + trackingId;
    await this.redis.zremrangebyscore(key, 0, now - cfg.windowMs);
    const count = await this.redis.zcard(key);
    return count >= cfg.maxRequests;
  }

  async markRateLimited(trackingId: string, retryAfterSeconds?: number): Promise<void> {
    const cooldownMs = retryAfterSeconds != null ? retryAfterSeconds * 1_000 : 60_000;
    const blockedUntil = Date.now() + cooldownMs;
    await this.redis.set(COOLDOWN_PREFIX + trackingId, String(blockedUntil), {
      px: cooldownMs,
    });
  }

  async clearRateLimit(trackingId: string): Promise<void> {
    await this.redis.del(COOLDOWN_PREFIX + trackingId);
  }

  async getWindowStats(trackingId: string): Promise<WindowStats> {
    const now = Date.now();
    const cfg = windowConfigFor(trackingId);
    const key = WINDOW_PREFIX + trackingId;
    await this.redis.zremrangebyscore(key, 0, now - cfg.windowMs);
    const count = await this.redis.zcard(key);
    const cd = await this.redis.get<string>(COOLDOWN_PREFIX + trackingId);
    let retryAfterMs: number | null = null;
    if (cd != null) {
      const blockedUntil = Number(cd);
      if (Number.isFinite(blockedUntil) && now < blockedUntil) {
        retryAfterMs = blockedUntil - now;
      }
    }
    return {
      requestsInWindow: count,
      maxRequests: cfg.maxRequests,
      windowMs: cfg.windowMs,
      retryAfterMs,
    };
  }
}
