import type { RateLimiterStore, WindowConfig, WindowStats } from "./types.js";

/** Conservative free-tier defaults per provider (kept below actual limits). */
export const PROVIDER_WINDOW_CONFIGS: Record<string, WindowConfig> = {
  groq: { windowMs: 60_000, maxRequests: 28 },
  gemini: { windowMs: 60_000, maxRequests: 13 },
  mistral: { windowMs: 60_000, maxRequests: 4 },
  nim: { windowMs: 60_000, maxRequests: 38 },
  cloudflare: { windowMs: 60_000, maxRequests: 20 },
  github: { windowMs: 60_000, maxRequests: 14 },
  ollama: { windowMs: 60_000, maxRequests: 999 },
};

export const FALLBACK_WINDOW_CONFIG: WindowConfig = { windowMs: 60_000, maxRequests: 10 };

/** Short cooldown when upstream omits Retry-After. */
export const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Sustained 429 streak → treat as likely daily-quota exhaustion.
 * Tunable via env; exported for tests.
 */
export function loadQuotaStreakConfig(): {
  threshold: number;
  minSpanMs: number;
  cooldownMs: number;
  breakMs: number;
} {
  const threshold = Number.parseInt(process.env.QUOTA_STREAK_THRESHOLD ?? "3", 10);
  const minSpanMs = Number.parseInt(process.env.QUOTA_STREAK_MIN_SPAN_MS ?? "180000", 10);
  const cooldownMs = Number.parseInt(process.env.QUOTA_COOLDOWN_MS ?? "28800000", 10);
  const breakMs = Number.parseInt(process.env.QUOTA_STREAK_BREAK_MS ?? "900000", 10);
  return {
    threshold: Number.isFinite(threshold) && threshold >= 1 ? threshold : 3,
    minSpanMs: Number.isFinite(minSpanMs) && minSpanMs >= 0 ? minSpanMs : 180_000,
    cooldownMs: Number.isFinite(cooldownMs) && cooldownMs >= 1_000 ? cooldownMs : 28_800_000,
    breakMs: Number.isFinite(breakMs) && breakMs >= 1_000 ? breakMs : 900_000,
  };
}

interface CooldownEntry {
  blockedUntil: number;
}

interface StreakEntry {
  firstAt: number;
  lastAt: number;
  count: number;
}

function getProviderId(trackingId: string): string {
  const hashIdx = trackingId.indexOf("#");
  return hashIdx === -1 ? trackingId : trackingId.substring(0, hashIdx);
}

export function windowConfigFor(trackingId: string): WindowConfig {
  return PROVIDER_WINDOW_CONFIGS[getProviderId(trackingId)] ?? FALLBACK_WINDOW_CONFIG;
}

/**
 * Compute the cooldown end timestamp after a 429, including sustained-quota
 * escalation when the streak spans long enough to look like RPD exhaustion
 * rather than a short RPM blip.
 */
export function computeBlockedUntil(
  now: number,
  retryAfterSeconds: number | undefined,
  streak: StreakEntry,
  cfg = loadQuotaStreakConfig(),
  existingBlockedUntil: number | null = null,
): number {
  const shortMs =
    retryAfterSeconds != null ? Math.max(1_000, retryAfterSeconds * 1_000) : DEFAULT_COOLDOWN_MS;
  let blockedUntil = now + shortMs;
  if (streak.count >= cfg.threshold && now - streak.firstAt >= cfg.minSpanMs) {
    blockedUntil = Math.max(blockedUntil, streak.firstAt + cfg.cooldownMs);
  }
  if (existingBlockedUntil != null && existingBlockedUntil > blockedUntil) {
    blockedUntil = existingBlockedUntil;
  }
  return blockedUntil;
}

export function nextStreak(
  existing: StreakEntry | undefined,
  now: number,
  breakMs: number,
): StreakEntry {
  if (!existing || now - existing.lastAt > breakMs) {
    return { firstAt: now, lastAt: now, count: 1 };
  }
  return { firstAt: existing.firstAt, lastAt: now, count: existing.count + 1 };
}

export class MemoryRateLimiterStore implements RateLimiterStore {
  private cooldowns = new Map<string, CooldownEntry>();
  private windows = new Map<string, number[]>();
  private streaks = new Map<string, StreakEntry>();

  async recordRequest(trackingId: string): Promise<void> {
    const now = Date.now();
    const cfg = windowConfigFor(trackingId);
    const existing = this.windows.get(trackingId) ?? [];
    const fresh = existing.filter((t) => now - t < cfg.windowMs);
    fresh.push(now);
    this.windows.set(trackingId, fresh);
  }

  async isRateLimited(trackingId: string): Promise<boolean> {
    const cooldown = this.cooldowns.get(trackingId);
    if (cooldown) {
      if (Date.now() < cooldown.blockedUntil) return true;
      this.cooldowns.delete(trackingId);
    }
    return this.isWindowFull(trackingId);
  }

  private isWindowFull(trackingId: string): boolean {
    const now = Date.now();
    const cfg = windowConfigFor(trackingId);
    const window = this.windows.get(trackingId);
    if (!window || window.length === 0) return false;
    const fresh = window.filter((t) => now - t < cfg.windowMs);
    this.windows.set(trackingId, fresh);
    return fresh.length >= cfg.maxRequests;
  }

  async markRateLimited(trackingId: string, retryAfterSeconds?: number): Promise<void> {
    const now = Date.now();
    const quota = loadQuotaStreakConfig();
    const streak = nextStreak(this.streaks.get(trackingId), now, quota.breakMs);
    this.streaks.set(trackingId, streak);

    const existing = this.cooldowns.get(trackingId);
    const blockedUntil = computeBlockedUntil(
      now,
      retryAfterSeconds,
      streak,
      quota,
      existing && now < existing.blockedUntil ? existing.blockedUntil : null,
    );
    this.cooldowns.set(trackingId, { blockedUntil });
  }

  async clearRateLimit(trackingId: string): Promise<void> {
    this.cooldowns.delete(trackingId);
    this.streaks.delete(trackingId);
    this.windows.delete(trackingId);
  }

  async clearProvider(providerId: string): Promise<void> {
    const prefix = `${providerId}#`;
    for (const id of [...this.cooldowns.keys()]) {
      if (id === providerId || id.startsWith(prefix)) this.cooldowns.delete(id);
    }
    for (const id of [...this.streaks.keys()]) {
      if (id === providerId || id.startsWith(prefix)) this.streaks.delete(id);
    }
    for (const id of [...this.windows.keys()]) {
      if (id === providerId || id.startsWith(prefix)) this.windows.delete(id);
    }
  }

  async getWindowStats(trackingId: string): Promise<WindowStats> {
    const now = Date.now();
    const cfg = windowConfigFor(trackingId);
    const window = this.windows.get(trackingId) ?? [];
    const fresh = window.filter((t) => now - t < cfg.windowMs);
    const cooldown = this.cooldowns.get(trackingId);
    const retryAfterMs =
      cooldown && now < cooldown.blockedUntil ? cooldown.blockedUntil - now : null;
    return {
      requestsInWindow: fresh.length,
      maxRequests: cfg.maxRequests,
      windowMs: cfg.windowMs,
      retryAfterMs,
    };
  }

  /** Test helper: inspect streak state. */
  getStreakForTest(trackingId: string): StreakEntry | undefined {
    return this.streaks.get(trackingId);
  }
}
