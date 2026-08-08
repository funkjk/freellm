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
 * Per-provider-key sliding-window rate limiter + 429 cooldown.
 * Implementations must treat record / check mutations as atomic per trackingId.
 */
export interface RateLimiterStore {
  recordRequest(trackingId: string): Promise<void>;
  isRateLimited(trackingId: string): Promise<boolean>;
  markRateLimited(trackingId: string, retryAfterSeconds?: number): Promise<void>;
  clearRateLimit(trackingId: string): Promise<void>;
  getWindowStats(trackingId: string): Promise<WindowStats>;
}
