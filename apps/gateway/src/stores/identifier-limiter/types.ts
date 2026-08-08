export interface IdentifierLimiterConfig {
  max: number;
  windowMs: number;
  maxBuckets: number;
}

export interface CheckResult {
  allowed: boolean;
  remaining: number;
  resetAfterMs: number;
  identifier: string;
}

/**
 * Per-identifier sliding-window rate limiter.
 * checkAndRecord must be atomic (read-prune-decide-write).
 */
export interface IdentifierLimiterStore {
  checkAndRecord(identifier: string, now?: number): Promise<CheckResult>;
  size(): Promise<number>;
  reset(): Promise<void>;
}
