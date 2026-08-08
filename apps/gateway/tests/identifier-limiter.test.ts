import { describe, expect, it } from "vitest";
import { IdentifierLimiter, parseIdentifierLimitEnv } from "../src/features/identifier-limiter.js";

const tightConfig = () => ({ max: 3, windowMs: 1_000, maxBuckets: 100 });

describe("IdentifierLimiter.checkAndRecord", () => {
  it("allows the first `max` requests and rejects the next", async () => {
    const limiter = new IdentifierLimiter(tightConfig());
    const now = 1_000_000;
    expect((await limiter.checkAndRecord("u", now)).allowed).toBe(true);
    expect((await limiter.checkAndRecord("u", now + 10)).allowed).toBe(true);
    expect((await limiter.checkAndRecord("u", now + 20)).allowed).toBe(true);
    const fourth = await limiter.checkAndRecord("u", now + 30);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("reports decreasing remaining count", async () => {
    const limiter = new IdentifierLimiter(tightConfig());
    const now = 100;
    expect((await limiter.checkAndRecord("u", now)).remaining).toBe(2);
    expect((await limiter.checkAndRecord("u", now)).remaining).toBe(1);
    expect((await limiter.checkAndRecord("u", now)).remaining).toBe(0);
  });

  it("different identifiers do not interfere", async () => {
    const limiter = new IdentifierLimiter(tightConfig());
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect((await limiter.checkAndRecord("alice", now)).allowed).toBe(true);
    }
    // alice is exhausted
    expect((await limiter.checkAndRecord("alice", now + 50)).allowed).toBe(false);
    // bob is untouched
    expect((await limiter.checkAndRecord("bob", now + 60)).allowed).toBe(true);
  });

  it("slides the window: old entries drop off and new requests succeed", async () => {
    const limiter = new IdentifierLimiter(tightConfig());
    const start = 1_000_000;
    for (let i = 0; i < 3; i++) await limiter.checkAndRecord("u", start + i);
    expect((await limiter.checkAndRecord("u", start + 500)).allowed).toBe(false);
    // Jump past the window — all earlier timestamps fall off.
    const afterWindow = start + 2_000;
    const result = await limiter.checkAndRecord("u", afterWindow);
    expect(result.allowed).toBe(true);
  });

  it("reports resetAfterMs equal to how long until the oldest slot expires", async () => {
    const limiter = new IdentifierLimiter(tightConfig());
    const start = 1_000_000;
    await limiter.checkAndRecord("u", start);
    await limiter.checkAndRecord("u", start + 100);
    await limiter.checkAndRecord("u", start + 200);
    const rejected = await limiter.checkAndRecord("u", start + 300);
    // Oldest timestamp is `start`, window is 1000, so it frees at start+1000.
    // Now is start+300, so resetAfterMs should be 700.
    expect(rejected.allowed).toBe(false);
    expect(rejected.resetAfterMs).toBe(700);
  });
});

describe("IdentifierLimiter LRU eviction", () => {
  it("drops the stalest identifier when maxBuckets is exceeded", async () => {
    const limiter = new IdentifierLimiter({ max: 5, windowMs: 60_000, maxBuckets: 3 });
    const now = 1_000_000;
    await limiter.checkAndRecord("a", now);
    await limiter.checkAndRecord("b", now + 1);
    await limiter.checkAndRecord("c", now + 2);
    expect(await limiter.size()).toBe(3);
    // Adding a 4th identifier should evict the stalest (a).
    await limiter.checkAndRecord("d", now + 3);
    expect(await limiter.size()).toBe(3);
    // If we check a now, it should be treated as a fresh bucket.
    const a = await limiter.checkAndRecord("a", now + 4);
    expect(a.allowed).toBe(true);
    expect(a.remaining).toBe(4);
  });
});

describe("IdentifierLimiter TTL eviction", () => {
  it("drops idle buckets after 2x the window", async () => {
    const limiter = new IdentifierLimiter({ max: 5, windowMs: 1_000, maxBuckets: 100 });
    const now = 1_000_000;
    await limiter.checkAndRecord("ghost", now);
    expect(await limiter.size()).toBe(1);
    // Subsequent checks with wildly later timestamps prune idle buckets.
    await limiter.checkAndRecord("new", now + 10_000);
    expect(await limiter.size()).toBe(1); // only "new" survived
  });
});

describe("IdentifierLimiter.reset", () => {
  it("clears every bucket", async () => {
    const limiter = new IdentifierLimiter(tightConfig());
    await limiter.checkAndRecord("a");
    await limiter.checkAndRecord("b");
    expect(await limiter.size()).toBe(2);
    await limiter.reset();
    expect(await limiter.size()).toBe(0);
  });
});

describe("parseIdentifierLimitEnv", () => {
  it("uses defaults when the env var is missing", () => {
    const cfg = parseIdentifierLimitEnv(undefined);
    expect(cfg.max).toBe(60);
    expect(cfg.windowMs).toBe(60_000);
    expect(cfg.maxBuckets).toBe(10_000);
  });

  it("parses a `<max>/<windowMs>` string", () => {
    const cfg = parseIdentifierLimitEnv("5/2000");
    expect(cfg.max).toBe(5);
    expect(cfg.windowMs).toBe(2_000);
  });

  it("tolerates whitespace around the value", () => {
    const cfg = parseIdentifierLimitEnv("  7 / 3000 ");
    expect(cfg.max).toBe(7);
    expect(cfg.windowMs).toBe(3_000);
  });

  it("falls back to defaults on garbage", () => {
    expect(parseIdentifierLimitEnv("soon").max).toBe(60);
    expect(parseIdentifierLimitEnv("10/0").max).toBe(60);
    expect(parseIdentifierLimitEnv("0/1000").max).toBe(60);
  });

  it("respects a caller-supplied maxBuckets", () => {
    const cfg = parseIdentifierLimitEnv("10/1000", 42);
    expect(cfg.maxBuckets).toBe(42);
  });
});
