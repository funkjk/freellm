export interface WindowConfig {
  windowMs: number;
  maxRequests: number;
}

export interface WindowStats {
  requestsInWindow: number;
  maxRequests: number;
  windowMs: number;
  retryAfterMs: number | null;
}

/**
 * Per-provider-key (or key+model) sliding-window rate limiter + 429 cooldown.
 * Implementations must treat record / check mutations as atomic per trackingId.
 *
 * `markRateLimited` also tracks a sustained-429 streak. When the streak reaches
 * the configured threshold over a minimum wall-clock span, the cooldown is
 * escalated to a long quota cache (daily / RPD exhaustion). Success must call
 * `clearRateLimit` to reset both cooldown and streak.
 */
export interface RateLimiterStore {
  recordRequest(trackingId: string): Promise<void>;
  isRateLimited(trackingId: string): Promise<boolean>;
  markRateLimited(trackingId: string, retryAfterSeconds?: number): Promise<void>;
  /** Clear cooldown, streak, and sliding window for one tracking id. */
  clearRateLimit(trackingId: string): Promise<void>;
  /**
   * Clear every rate-limit artifact for a provider id (cooldown, streak,
   * window), including orphaned model keys left after catalog changes.
   */
  clearProvider(providerId: string): Promise<void>;
  getWindowStats(trackingId: string): Promise<WindowStats>;
}
