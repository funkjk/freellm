import { getStores } from "../stores/create-stores.js";
import type { CircuitBreakerStore } from "../stores/circuit-breaker/types.js";
import type { RateLimiterStore } from "../stores/rate-limiter/types.js";
import type {
  ChatCompletionRequest,
  CircuitBreakerState,
  KeyStatus,
  ModelObject,
  ProviderStats,
} from "../types.js";
import type { ProviderAdapter } from "./types.js";

/** Parse a comma-separated env var into a trimmed, filtered key array. */
export function parseApiKeys(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export abstract class BaseProvider implements ProviderAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly baseUrl: string;
  abstract readonly models: ModelObject[];
  readonly supportsStreamUsage: boolean = false;
  readonly supportsTools: boolean = true;

  protected circuitBreaker!: CircuitBreakerStore;
  protected rateLimiter!: RateLimiterStore;
  private storesBound = false;

  protected stats: ProviderStats = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
  };

  private keyRotationIndex = 0;
  private responseKeyMap = new WeakMap<Response, string>();

  /** Bind rate limiter + circuit breaker once `this.id` is available. */
  protected ensureBound(): void {
    if (this.storesBound) return;
    const stores = getStores();
    this.rateLimiter = stores.createRateLimiter();
    this.circuitBreaker = stores.createCircuitBreaker(this.id);
    this.storesBound = true;
  }

  protected abstract getApiKeys(): string[];

  protected trackingId(keyIndex: number): string {
    return `${this.id}#${keyIndex}`;
  }

  isEnabled(): boolean {
    return this.getApiKeys().length > 0;
  }

  getStats(): ProviderStats {
    return { ...this.stats };
  }

  async getCircuitBreakerState(): Promise<CircuitBreakerState> {
    this.ensureBound();
    return this.circuitBreaker.getState();
  }

  async isAvailable(): Promise<boolean> {
    this.ensureBound();
    if (!this.isEnabled()) return false;
    if (!(await this.circuitBreaker.isAllowed())) return false;
    const keys = this.getApiKeys();
    for (let i = 0; i < keys.length; i++) {
      if (!(await this.rateLimiter.isRateLimited(this.trackingId(i)))) return true;
    }
    return false;
  }

  async getKeysStatus(): Promise<KeyStatus[]> {
    this.ensureBound();
    const keys = this.getApiKeys();
    const out: KeyStatus[] = [];
    for (let i = 0; i < keys.length; i++) {
      const trackingId = this.trackingId(i);
      const stats = await this.rateLimiter.getWindowStats(trackingId);
      out.push({
        index: i,
        rateLimited: await this.rateLimiter.isRateLimited(trackingId),
        requestsInWindow: stats.requestsInWindow,
        maxRequests: stats.maxRequests,
        retryAfterMs: stats.retryAfterMs,
      });
    }
    return out;
  }

  protected attachResponseToKey(response: Response, trackingId: string): void {
    this.responseKeyMap.set(response, trackingId);
  }

  protected async pickKey(): Promise<
    { key: string; trackingId: string; keyIndex: number } | undefined
  > {
    this.ensureBound();
    const keys = this.getApiKeys();
    if (keys.length === 0) return undefined;

    for (let i = 0; i < keys.length; i++) {
      const idx = (this.keyRotationIndex + i) % keys.length;
      const trackingId = this.trackingId(idx);
      if (!(await this.rateLimiter.isRateLimited(trackingId))) {
        this.keyRotationIndex = (idx + 1) % keys.length;
        const key = keys[idx];
        if (!key) continue;
        return { key, trackingId, keyIndex: idx };
      }
    }
    return undefined;
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    this.ensureBound();
    const picked = await this.pickKey();
    if (!picked) {
      throw new Error(
        `Provider ${this.name} has no available keys (all rate-limited or not configured)`,
      );
    }

    this.stats.totalRequests++;
    this.stats.lastUsedAt = new Date().toISOString();
    await this.rateLimiter.recordRequest(picked.trackingId);

    const mapped = this.mapRequest(request);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${picked.key}`,
        ...this.extraHeaders(),
      },
      body: JSON.stringify(mapped),
    });

    this.attachResponseToKey(response, picked.trackingId);
    return response;
  }

  protected mapRequest(request: ChatCompletionRequest): ChatCompletionRequest {
    const mapped = { ...request };
    const prefix = `${this.id}/`;
    if (mapped.model.startsWith(prefix)) {
      mapped.model = mapped.model.slice(prefix.length);
    }
    return mapped;
  }

  protected extraHeaders(): Record<string, string> {
    return {};
  }

  async onSuccess(response: Response): Promise<void> {
    this.ensureBound();
    this.stats.successRequests++;
    await this.circuitBreaker.onSuccess();
    const trackingId = this.responseKeyMap.get(response);
    if (trackingId) await this.rateLimiter.clearRateLimit(trackingId);
  }

  async onRateLimit(response: Response, retryAfterSeconds?: number): Promise<void> {
    this.ensureBound();
    this.stats.rateLimitedRequests++;
    const trackingId = this.responseKeyMap.get(response);
    if (trackingId) {
      await this.rateLimiter.markRateLimited(trackingId, retryAfterSeconds);
    }
  }

  async onError(): Promise<void> {
    this.ensureBound();
    this.stats.failedRequests++;
    await this.circuitBreaker.onFailure();
    this.stats.lastError = new Date().toISOString();
  }

  async resetCircuitBreaker(): Promise<void> {
    this.ensureBound();
    await this.circuitBreaker.reset();
    const keys = this.getApiKeys();
    for (let i = 0; i < keys.length; i++) {
      await this.rateLimiter.clearRateLimit(this.trackingId(i));
    }
  }
}
