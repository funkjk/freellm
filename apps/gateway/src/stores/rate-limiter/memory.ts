import type { RateLimiterStore, WindowConfig, WindowStats } from "./types.js";

/** Conservative free-tier defaults per provider (kept below actual limits). */
export const PROVIDER_WINDOW_CONFIGS: Record<string, WindowConfig> = {
  groq: { windowMs: 60_000, maxRequests: 28 },
  gemini: { windowMs: 60_000, maxRequests: 13 },
  mistral: { windowMs: 60_000, maxRequests: 4 },
  cerebras: { windowMs: 60_000, maxRequests: 28 },
  nim: { windowMs: 60_000, maxRequests: 38 },
  cloudflare: { windowMs: 60_000, maxRequests: 20 },
  github: { windowMs: 60_000, maxRequests: 14 },
  ollama: { windowMs: 60_000, maxRequests: 999 },
};

export const FALLBACK_WINDOW_CONFIG: WindowConfig = { windowMs: 60_000, maxRequests: 10 };

interface CooldownEntry {
  blockedUntil: number;
}

function getProviderId(trackingId: string): string {
  const hashIdx = trackingId.indexOf("#");
  return hashIdx === -1 ? trackingId : trackingId.substring(0, hashIdx);
}

export function windowConfigFor(trackingId: string): WindowConfig {
  return PROVIDER_WINDOW_CONFIGS[getProviderId(trackingId)] ?? FALLBACK_WINDOW_CONFIG;
}

export class MemoryRateLimiterStore implements RateLimiterStore {
  private cooldowns = new Map<string, CooldownEntry>();
  private windows = new Map<string, number[]>();

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
    const cooldownMs = retryAfterSeconds != null ? retryAfterSeconds * 1_000 : 60_000;
    this.cooldowns.set(trackingId, { blockedUntil: Date.now() + cooldownMs });
  }

  async clearRateLimit(trackingId: string): Promise<void> {
    this.cooldowns.delete(trackingId);
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
}
