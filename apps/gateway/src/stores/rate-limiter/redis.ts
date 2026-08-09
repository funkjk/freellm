import type { Redis } from "@upstash/redis";
import {
  DEFAULT_COOLDOWN_MS,
  computeBlockedUntil,
  loadQuotaStreakConfig,
  nextStreak,
  windowConfigFor,
} from "./memory.js";
import type { RateLimiterStore, WindowStats } from "./types.js";

const WINDOW_PREFIX = "freellm:rl:w:";
const COOLDOWN_PREFIX = "freellm:rl:cd:";
const STREAK_PREFIX = "freellm:rl:st:";

interface StreakEntry {
  firstAt: number;
  lastAt: number;
  count: number;
}

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
    const now = Date.now();
    const quota = loadQuotaStreakConfig();
    const raw = await this.redis.get<string>(STREAK_PREFIX + trackingId);
    let existingStreak: StreakEntry | undefined;
    if (raw) {
      try {
        existingStreak = JSON.parse(raw) as StreakEntry;
      } catch {
        existingStreak = undefined;
      }
    }
    const streak = nextStreak(existingStreak, now, quota.breakMs);

    const cd = await this.redis.get<string>(COOLDOWN_PREFIX + trackingId);
    let existingBlocked: number | null = null;
    if (cd != null) {
      const n = Number(cd);
      if (Number.isFinite(n) && n > now) existingBlocked = n;
    }

    const blockedUntil = computeBlockedUntil(
      now,
      retryAfterSeconds,
      streak,
      quota,
      existingBlocked,
    );
    const ttlMs = Math.max(1_000, blockedUntil - now);
    // Keep streak around for at least the quota cooldown so a later 429
    // after a short blip can still see history; breakMs handles idle reset.
    const streakTtl = Math.max(ttlMs, quota.cooldownMs, quota.breakMs);

    await this.redis.set(STREAK_PREFIX + trackingId, JSON.stringify(streak), {
      px: streakTtl,
    });
    await this.redis.set(COOLDOWN_PREFIX + trackingId, String(blockedUntil), {
      px: ttlMs,
    });
  }

  async clearRateLimit(trackingId: string): Promise<void> {
    await this.redis.del(
      COOLDOWN_PREFIX + trackingId,
      STREAK_PREFIX + trackingId,
      WINDOW_PREFIX + trackingId,
    );
  }

  async clearProvider(providerId: string): Promise<void> {
    const patterns = [
      `${COOLDOWN_PREFIX}${providerId}`,
      `${COOLDOWN_PREFIX}${providerId}#*`,
      `${STREAK_PREFIX}${providerId}`,
      `${STREAK_PREFIX}${providerId}#*`,
      `${WINDOW_PREFIX}${providerId}`,
      `${WINDOW_PREFIX}${providerId}#*`,
    ];
    const toDelete = new Set<string>();
    for (const pattern of patterns) {
      if (pattern.endsWith("*")) {
        const found = await this.redis.keys(pattern);
        for (const key of found ?? []) toDelete.add(key);
      } else {
        toDelete.add(pattern);
      }
    }
    if (toDelete.size > 0) {
      await this.redis.del(...toDelete);
    }
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

// Re-export so callers that imported DEFAULT from redis keep compiling if any.
export { DEFAULT_COOLDOWN_MS };
