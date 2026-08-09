import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryRateLimiterStore,
  computeBlockedUntil,
  loadQuotaStreakConfig,
  nextStreak,
} from "../src/stores/rate-limiter/memory.js";

describe("nextStreak", () => {
  it("starts a fresh streak when none exists", () => {
    expect(nextStreak(undefined, 1_000, 900_000)).toEqual({
      firstAt: 1_000,
      lastAt: 1_000,
      count: 1,
    });
  });

  it("increments when within the break window", () => {
    const existing = { firstAt: 1_000, lastAt: 2_000, count: 2 };
    expect(nextStreak(existing, 3_000, 900_000)).toEqual({
      firstAt: 1_000,
      lastAt: 3_000,
      count: 3,
    });
  });

  it("resets when idle longer than breakMs", () => {
    const existing = { firstAt: 1_000, lastAt: 2_000, count: 5 };
    expect(nextStreak(existing, 2_000 + 900_001, 900_000)).toEqual({
      firstAt: 2_000 + 900_001,
      lastAt: 2_000 + 900_001,
      count: 1,
    });
  });
});

describe("computeBlockedUntil", () => {
  const cfg = {
    threshold: 3,
    minSpanMs: 180_000,
    cooldownMs: 28_800_000,
    breakMs: 900_000,
  };

  it("uses the short Retry-After when the streak is too short", () => {
    const streak = { firstAt: 0, lastAt: 60_000, count: 3 };
    // span = 60s < 3min
    expect(computeBlockedUntil(60_000, 60, streak, cfg)).toBe(60_000 + 60_000);
  });

  it("escalates to firstAt + 8h when count and span thresholds are met", () => {
    const streak = { firstAt: 1_000_000, lastAt: 1_000_000 + 180_000, count: 3 };
    const now = 1_000_000 + 180_000;
    const blocked = computeBlockedUntil(now, 60, streak, cfg);
    expect(blocked).toBe(1_000_000 + 28_800_000);
  });

  it("does not shorten an existing longer cooldown", () => {
    const streak = { firstAt: 0, lastAt: 1_000, count: 1 };
    const blocked = computeBlockedUntil(1_000, 30, streak, cfg, 1_000 + 600_000);
    expect(blocked).toBe(1_000 + 600_000);
  });
});

describe("MemoryRateLimiterStore sustained 429 quota cache", () => {
  const id = "gemini#0#gemini-3.6-flash";
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of [
      "QUOTA_STREAK_THRESHOLD",
      "QUOTA_STREAK_MIN_SPAN_MS",
      "QUOTA_COOLDOWN_MS",
      "QUOTA_STREAK_BREAK_MS",
    ]) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });

  function setEnv(values: Record<string, string>) {
    for (const [k, v] of Object.entries(values)) {
      prev[k] = process.env[k];
      process.env[k] = v;
    }
  }

  it("keeps a short cooldown for three rapid 429s (RPM-like)", async () => {
    setEnv({
      QUOTA_STREAK_THRESHOLD: "3",
      QUOTA_STREAK_MIN_SPAN_MS: "180000",
      QUOTA_COOLDOWN_MS: "28800000",
    });
    expect(loadQuotaStreakConfig().minSpanMs).toBe(180_000);

    const store = new MemoryRateLimiterStore();
    const t0 = Date.now();
    // Monkeypatch Date.now for deterministic span — use real time with
    // injected retryAfter only; rapid marks share ~0 span via same ms.
    await store.markRateLimited(id, 30);
    await store.markRateLimited(id, 30);
    await store.markRateLimited(id, 30);

    const stats = await store.getWindowStats(id);
    expect(stats.retryAfterMs).not.toBeNull();
    expect(stats.retryAfterMs!).toBeLessThan(60_000);
    expect(store.getStreakForTest(id)?.count).toBe(3);
    // Must not have jumped to ~8h
    expect(stats.retryAfterMs!).toBeLessThan(3_600_000);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("caches ~8h from first failure when 3x 429 span at least 3 minutes", async () => {
    setEnv({
      QUOTA_STREAK_THRESHOLD: "3",
      QUOTA_STREAK_MIN_SPAN_MS: "180000",
      QUOTA_COOLDOWN_MS: "28800000",
      QUOTA_STREAK_BREAK_MS: "900000",
    });

    const store = new MemoryRateLimiterStore();
    const realNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;

    try {
      await store.markRateLimited(id, 60);
      now += 90_000;
      await store.markRateLimited(id, 60);
      now += 90_000; // total span 180s
      await store.markRateLimited(id, 60);

      const stats = await store.getWindowStats(id);
      expect(stats.retryAfterMs).not.toBeNull();
      // firstAt + 8h - now ≈ 8h - 180s
      const expected = 28_800_000 - 180_000;
      expect(stats.retryAfterMs!).toBeGreaterThan(expected - 1_000);
      expect(stats.retryAfterMs!).toBeLessThanOrEqual(expected + 1_000);
      expect(await store.isRateLimited(id)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("clears streak and cooldown on success path (clearRateLimit)", async () => {
    const store = new MemoryRateLimiterStore();
    await store.markRateLimited(id, 60);
    expect(store.getStreakForTest(id)?.count).toBe(1);
    await store.clearRateLimit(id);
    expect(store.getStreakForTest(id)).toBeUndefined();
    expect(await store.isRateLimited(id)).toBe(false);
  });
});
