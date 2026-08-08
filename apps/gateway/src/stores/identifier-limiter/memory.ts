import type { CheckResult, IdentifierLimiterConfig, IdentifierLimiterStore } from "./types.js";

interface Bucket {
  timestamps: number[];
  lastSeen: number;
}

export class MemoryIdentifierLimiterStore implements IdentifierLimiterStore {
  private buckets = new Map<string, Bucket>();
  private config: IdentifierLimiterConfig;

  constructor(config: IdentifierLimiterConfig) {
    if (config.max < 1) throw new Error("IdentifierLimiter.max must be >= 1");
    if (config.windowMs < 1) throw new Error("IdentifierLimiter.windowMs must be >= 1");
    if (config.maxBuckets < 1) throw new Error("IdentifierLimiter.maxBuckets must be >= 1");
    this.config = config;
  }

  async checkAndRecord(identifier: string, now: number = Date.now()): Promise<CheckResult> {
    this.pruneIdleBuckets(now);

    let bucket = this.buckets.get(identifier);
    if (!bucket) {
      if (this.buckets.size >= this.config.maxBuckets) {
        this.evictStalest();
      }
      bucket = { timestamps: [], lastSeen: now };
      this.buckets.set(identifier, bucket);
    }

    const windowStart = now - this.config.windowMs;
    const fresh: number[] = [];
    for (const t of bucket.timestamps) {
      if (t > windowStart) fresh.push(t);
    }
    bucket.timestamps = fresh;
    bucket.lastSeen = now;
    this.buckets.delete(identifier);
    this.buckets.set(identifier, bucket);

    if (bucket.timestamps.length >= this.config.max) {
      const oldest = bucket.timestamps[0] ?? now;
      const resetAfterMs = Math.max(0, oldest + this.config.windowMs - now);
      return {
        allowed: false,
        remaining: 0,
        resetAfterMs,
        identifier,
      };
    }

    bucket.timestamps.push(now);
    return {
      allowed: true,
      remaining: this.config.max - bucket.timestamps.length,
      resetAfterMs: this.config.windowMs,
      identifier,
    };
  }

  private pruneIdleBuckets(now: number): void {
    const idleCutoff = now - this.config.windowMs * 2;
    for (const [id, bucket] of this.buckets) {
      if (bucket.lastSeen < idleCutoff) {
        this.buckets.delete(id);
      }
    }
  }

  private evictStalest(): void {
    const firstKey = this.buckets.keys().next().value;
    if (firstKey !== undefined) this.buckets.delete(firstKey);
  }

  async size(): Promise<number> {
    return this.buckets.size;
  }

  async reset(): Promise<void> {
    this.buckets.clear();
  }
}

const DEFAULT_MAX = 60;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_BUCKETS = 10_000;

export function parseIdentifierLimitEnv(
  value: string | undefined,
  maxBuckets: number = DEFAULT_MAX_BUCKETS,
): IdentifierLimiterConfig {
  if (!value) return { max: DEFAULT_MAX, windowMs: DEFAULT_WINDOW_MS, maxBuckets };
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(value);
  if (!match) return { max: DEFAULT_MAX, windowMs: DEFAULT_WINDOW_MS, maxBuckets };
  const max = Number.parseInt(match[1] as string, 10);
  const windowMs = Number.parseInt(match[2] as string, 10);
  if (max < 1 || windowMs < 1) {
    return { max: DEFAULT_MAX, windowMs: DEFAULT_WINDOW_MS, maxBuckets };
  }
  return { max, windowMs, maxBuckets };
}
