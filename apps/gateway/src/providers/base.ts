import { getStores } from "../stores/create-stores.js";
import type { CircuitBreakerStore } from "../stores/circuit-breaker/types.js";
import type { RateLimiterStore } from "../stores/rate-limiter/types.js";
import type {
  ChatCompletionRequest,
  CircuitBreakerState,
  KeyStatus,
  ModelObject,
  ModelRateStatus,
  ProviderStats,
} from "../types.js";
import type { ProviderAdapter, RateLimitScope } from "./types.js";

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
  /** Override to `"model"` when upstream free-tier quotas are per model. */
  readonly rateLimitScope: RateLimitScope = "key";

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

  /** Upstream model id (provider prefix stripped) used in per-model tracking. */
  protected upstreamModelId(modelId: string): string {
    const prefix = `${this.id}/`;
    return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
  }

  protected trackingId(keyIndex: number, modelId?: string): string {
    if (this.rateLimitScope === "model" && modelId) {
      return `${this.id}#${keyIndex}#${this.upstreamModelId(modelId)}`;
    }
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

  async isManuallyDisabled(): Promise<boolean> {
    return getStores().providerDisable.isDisabled(this.id);
  }

  async isAvailable(): Promise<boolean> {
    this.ensureBound();
    if (!this.isEnabled()) return false;
    if (await this.isManuallyDisabled()) return false;
    if (!(await this.circuitBreaker.isAllowed())) return false;
    const keys = this.getApiKeys();
    for (let i = 0; i < keys.length; i++) {
      if (this.rateLimitScope === "model") {
        for (const model of this.models) {
          if (!(await this.rateLimiter.isRateLimited(this.trackingId(i, model.id)))) {
            return true;
          }
        }
      } else if (!(await this.rateLimiter.isRateLimited(this.trackingId(i)))) {
        return true;
      }
    }
    return false;
  }

  async isAvailableForModel(modelId: string): Promise<boolean> {
    this.ensureBound();
    if (!this.isEnabled()) return false;
    if (await this.isManuallyDisabled()) return false;
    if (!(await this.circuitBreaker.isAllowed())) return false;
    if (this.rateLimitScope !== "model") return this.isAvailable();
    const keys = this.getApiKeys();
    for (let i = 0; i < keys.length; i++) {
      if (!(await this.rateLimiter.isRateLimited(this.trackingId(i, modelId)))) {
        return true;
      }
    }
    return false;
  }

  async getKeysStatus(): Promise<KeyStatus[]> {
    this.ensureBound();
    const keys = this.getApiKeys();
    const out: KeyStatus[] = [];
    for (let i = 0; i < keys.length; i++) {
      if (this.rateLimitScope === "model") {
        let anyAvailable = false;
        let minRetry: number | null = null;
        let requestsInWindow = 0;
        let maxRequests = 0;
        for (const model of this.models) {
          const trackingId = this.trackingId(i, model.id);
          const stats = await this.rateLimiter.getWindowStats(trackingId);
          const limited = await this.rateLimiter.isRateLimited(trackingId);
          if (!limited) anyAvailable = true;
          if (stats.retryAfterMs != null) {
            minRetry =
              minRetry == null ? stats.retryAfterMs : Math.min(minRetry, stats.retryAfterMs);
          }
          requestsInWindow = Math.max(requestsInWindow, stats.requestsInWindow);
          maxRequests = Math.max(maxRequests, stats.maxRequests);
        }
        out.push({
          index: i,
          rateLimited: !anyAvailable,
          requestsInWindow,
          maxRequests,
          retryAfterMs: anyAvailable ? null : minRetry,
        });
      } else {
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
    }
    return out;
  }

  async getModelsStatus(): Promise<ModelRateStatus[]> {
    if (this.rateLimitScope !== "model") return [];
    this.ensureBound();
    const keys = this.getApiKeys();
    const out: ModelRateStatus[] = [];
    for (const model of this.models) {
      if (keys.length === 0) {
        out.push({
          id: model.id,
          rateLimited: true,
          requestsInWindow: 0,
          maxRequests: 0,
          retryAfterMs: null,
        });
        continue;
      }
      let anyAvailable = false;
      let minRetry: number | null = null;
      let requestsInWindow = 0;
      let maxRequests = 0;
      for (let i = 0; i < keys.length; i++) {
        const trackingId = this.trackingId(i, model.id);
        const stats = await this.rateLimiter.getWindowStats(trackingId);
        const limited = await this.rateLimiter.isRateLimited(trackingId);
        if (!limited) anyAvailable = true;
        if (stats.retryAfterMs != null) {
          minRetry = minRetry == null ? stats.retryAfterMs : Math.min(minRetry, stats.retryAfterMs);
        }
        requestsInWindow = Math.max(requestsInWindow, stats.requestsInWindow);
        maxRequests = Math.max(maxRequests, stats.maxRequests);
      }
      out.push({
        id: model.id,
        rateLimited: !anyAvailable,
        requestsInWindow,
        maxRequests,
        retryAfterMs: anyAvailable ? null : minRetry,
      });
    }
    return out;
  }

  protected attachResponseToKey(response: Response, trackingId: string): void {
    this.responseKeyMap.set(response, trackingId);
  }

  protected async pickKey(
    modelId?: string,
  ): Promise<{ key: string; trackingId: string; keyIndex: number } | undefined> {
    this.ensureBound();
    const keys = this.getApiKeys();
    if (keys.length === 0) return undefined;

    for (let i = 0; i < keys.length; i++) {
      const idx = (this.keyRotationIndex + i) % keys.length;
      const trackingId = this.trackingId(idx, modelId);
      if (!(await this.rateLimiter.isRateLimited(trackingId))) {
        this.keyRotationIndex = (idx + 1) % keys.length;
        const key = keys[idx];
        if (!key) continue;
        return { key, trackingId, keyIndex: idx };
      }
    }
    return undefined;
  }

  /** Per-attempt upstream deadline. Hung providers must not block the route loop. */
  protected fetchTimeoutMs(): number {
    const n = Number.parseInt(process.env.PROVIDER_FETCH_TIMEOUT_MS ?? "20000", 10);
    return Number.isFinite(n) && n >= 1_000 ? n : 20_000;
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    this.ensureBound();
    const modelForLimit = this.rateLimitScope === "model" ? request.model : undefined;
    const picked = await this.pickKey(modelForLimit);
    if (!picked) {
      throw new Error(
        `Provider ${this.name} has no available keys (all rate-limited or not configured)`,
      );
    }

    this.stats.totalRequests++;
    this.stats.lastUsedAt = new Date().toISOString();
    await this.rateLimiter.recordRequest(picked.trackingId);

    const mapped = this.mapRequest(request);
    const timeoutMs = this.fetchTimeoutMs();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${picked.key}`,
        ...this.extraHeaders(),
      },
      body: JSON.stringify(mapped),
      signal: AbortSignal.timeout(timeoutMs),
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

  /**
   * Reset operator-visible routing state for this provider: circuit breaker,
   * per-key/per-model cooldowns, sustained-429 streaks, and sliding windows
   * (including Redis-backed keys).
   */
  async resetCircuitBreaker(): Promise<void> {
    this.ensureBound();
    await this.circuitBreaker.reset();
    await this.rateLimiter.clearProvider(this.id);
  }
}
