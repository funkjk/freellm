import type { Redis } from "@upstash/redis";
import { MemoryCacheBackend } from "./cache/memory.js";
import type { CacheBackend } from "./cache/types.js";
import { MemoryCircuitBreakerStore } from "./circuit-breaker/memory.js";
import type { CircuitBreakerStore } from "./circuit-breaker/types.js";
import {
  MemoryIdentifierLimiterStore,
  parseIdentifierLimitEnv,
} from "./identifier-limiter/memory.js";
import type {
  IdentifierLimiterConfig,
  IdentifierLimiterStore,
} from "./identifier-limiter/types.js";
import { MemoryRateLimiterStore } from "./rate-limiter/memory.js";
import type { RateLimiterStore } from "./rate-limiter/types.js";
import { resolveStateBackend, type StateBackend } from "./types.js";
import { MemoryUsageTrackerStore } from "./usage/memory.js";
import type { UsageTrackerStore } from "./usage/types.js";
import { MemoryProviderDisableStore } from "./provider-disable/memory.js";
import type { ProviderDisableStore } from "./provider-disable/types.js";
import { MemoryVirtualKeyCounterStore } from "./virtual-keys/memory.js";
import type { VirtualKeyCounterStore } from "./virtual-keys/types.js";
import { MemoryRequestMetricsStore } from "./request-metrics/memory.js";
import type { RequestMetricsStore } from "./request-metrics/types.js";
import { MemoryRequestLogStore } from "./request-log/memory.js";
import type { RequestLogStore } from "./request-log/types.js";
import { MemoryRoutingConfigStore } from "./routing-config/memory.js";
import type { RoutingConfigStore } from "./routing-config/types.js";

function requestLogMaxEntries(): number {
  const n = Number.parseInt(process.env.REQUEST_LOG_MAX_ENTRIES ?? "500", 10);
  return Number.isFinite(n) && n >= 1 ? n : 500;
}

export interface GatewayStores {
  backend: StateBackend;
  redis: Redis | null;
  createRateLimiter: () => RateLimiterStore;
  createCircuitBreaker: (providerId: string) => CircuitBreakerStore;
  createIdentifierLimiter: (config?: IdentifierLimiterConfig) => IdentifierLimiterStore;
  cacheBackend: CacheBackend;
  usageTracker: UsageTrackerStore;
  vkCounters: VirtualKeyCounterStore;
  providerDisable: ProviderDisableStore;
  requestMetrics: RequestMetricsStore;
  requestLogStore: RequestLogStore;
  routingConfig: RoutingConfigStore;
}

function createMemoryStores(): GatewayStores {
  const maxLog = requestLogMaxEntries();
  return {
    backend: "memory",
    redis: null,
    createRateLimiter: () => new MemoryRateLimiterStore(),
    createCircuitBreaker: (_providerId: string) => new MemoryCircuitBreakerStore(),
    createIdentifierLimiter: (config) =>
      new MemoryIdentifierLimiterStore(
        config ??
          parseIdentifierLimitEnv(
            process.env.FREELLM_IDENTIFIER_LIMIT,
            Number.parseInt(process.env.FREELLM_IDENTIFIER_MAX_BUCKETS ?? "10000", 10),
          ),
      ),
    cacheBackend: new MemoryCacheBackend(),
    usageTracker: new MemoryUsageTrackerStore(),
    vkCounters: new MemoryVirtualKeyCounterStore(),
    providerDisable: new MemoryProviderDisableStore(),
    requestMetrics: new MemoryRequestMetricsStore(),
    requestLogStore: new MemoryRequestLogStore(maxLog),
    routingConfig: new MemoryRoutingConfigStore(),
  };
}

let _stores: GatewayStores | null = null;

/**
 * Build gateway stores for the configured backend.
 * Redis implementations are loaded lazily so memory-only deploys never
 * touch @upstash/redis at runtime beyond the type import being erased.
 */
export async function createStores(
  backend: StateBackend = resolveStateBackend(),
): Promise<GatewayStores> {
  if (backend === "memory") {
    return createMemoryStores();
  }

  const { createRedisClient } = await import("./redis-client.js");
  const { RedisRateLimiterStore } = await import("./rate-limiter/redis.js");
  const { RedisCircuitBreakerStore } = await import("./circuit-breaker/redis.js");
  const { RedisIdentifierLimiterStore } = await import("./identifier-limiter/redis.js");
  const { RedisCacheBackend } = await import("./cache/redis.js");
  const { RedisUsageTrackerStore } = await import("./usage/redis.js");
  const { RedisVirtualKeyCounterStore } = await import("./virtual-keys/redis.js");
  const { RedisProviderDisableStore } = await import("./provider-disable/redis.js");
  const { RedisRequestMetricsStore } = await import("./request-metrics/redis.js");
  const { RedisRequestLogStore } = await import("./request-log/redis.js");
  const { RedisRoutingConfigStore } = await import("./routing-config/redis.js");

  const redis = createRedisClient();
  const maxLog = requestLogMaxEntries();
  return {
    backend: "redis",
    redis,
    createRateLimiter: () => new RedisRateLimiterStore(redis),
    createCircuitBreaker: (providerId: string) =>
      new RedisCircuitBreakerStore(redis, providerId),
    createIdentifierLimiter: (config) =>
      new RedisIdentifierLimiterStore(
        redis,
        config ??
          parseIdentifierLimitEnv(
            process.env.FREELLM_IDENTIFIER_LIMIT,
            Number.parseInt(process.env.FREELLM_IDENTIFIER_MAX_BUCKETS ?? "10000", 10),
          ),
      ),
    cacheBackend: new RedisCacheBackend(redis),
    usageTracker: new RedisUsageTrackerStore(redis),
    vkCounters: new RedisVirtualKeyCounterStore(redis),
    providerDisable: new RedisProviderDisableStore(redis),
    requestMetrics: new RedisRequestMetricsStore(redis),
    requestLogStore: new RedisRequestLogStore(redis, maxLog),
    routingConfig: new RedisRoutingConfigStore(redis),
  };
}

/** Initialize (or return) the process-wide store singleton. */
export async function initStores(backend?: StateBackend): Promise<GatewayStores> {
  if (_stores && (backend === undefined || backend === _stores.backend)) {
    return _stores;
  }
  _stores = await createStores(backend);
  return _stores;
}

export function getStores(): GatewayStores {
  if (!_stores) {
    // Sync fallback for tests that construct providers before initStores.
    _stores = createMemoryStores();
  }
  return _stores;
}

/** Test helper: replace the singleton. */
export function setStores(stores: GatewayStores): void {
  _stores = stores;
}

/** Test helper: reset to uninitialized. */
export function resetStores(): void {
  _stores = null;
}
