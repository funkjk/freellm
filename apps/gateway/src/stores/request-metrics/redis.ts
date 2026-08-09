import type { Redis } from "@upstash/redis";
import {
  type OutcomeKind,
  type OutcomeTotals,
  type RequestMetricsStore,
  emptyOutcomeTotals,
} from "./types.js";

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 24;
const KEY_PREFIX = "freellm:reqmetrics:";
const INDEX_KEY = "freellm:reqmetrics:providers";

export class RedisRequestMetricsStore implements RequestMetricsStore {
  constructor(private redis: Redis) {}

  private currentHour(): number {
    return Math.floor(Date.now() / HOUR_MS);
  }

  private hourKey(providerId: string, hour: number): string {
    return `${KEY_PREFIX}${providerId}:${hour}`;
  }

  async record(providerId: string, kind: OutcomeKind): Promise<void> {
    const hour = this.currentHour();
    const key = this.hourKey(providerId, hour);
    const field = kind === "success" ? "success" : kind === "rate_limited" ? "rateLimited" : "failed";
    await this.redis.hincrby(key, field, 1);
    await this.redis.pexpire(key, WINDOW_HOURS * HOUR_MS);
    await this.redis.sadd(INDEX_KEY, providerId);
  }

  async getTotals(providerId: string): Promise<OutcomeTotals> {
    const now = this.currentHour();
    let successRequests = 0;
    let failedRequests = 0;
    let rateLimitedRequests = 0;
    for (let h = now - WINDOW_HOURS + 1; h <= now; h++) {
      const raw = await this.redis.hgetall<Record<string, string>>(this.hourKey(providerId, h));
      if (!raw) continue;
      successRequests += Number(raw.success ?? 0);
      failedRequests += Number(raw.failed ?? 0);
      rateLimitedRequests += Number(raw.rateLimited ?? 0);
    }
    return {
      totalRequests: successRequests + failedRequests + rateLimitedRequests,
      successRequests,
      failedRequests,
      rateLimitedRequests,
    };
  }

  async getAllTotals(): Promise<{
    byProvider: Record<string, OutcomeTotals>;
    gateway: OutcomeTotals;
  }> {
    const providers = (await this.redis.smembers(INDEX_KEY)) ?? [];
    const byProvider: Record<string, OutcomeTotals> = {};
    const gateway = emptyOutcomeTotals();
    for (const providerId of providers) {
      const totals = await this.getTotals(providerId);
      byProvider[providerId] = totals;
      gateway.totalRequests += totals.totalRequests;
      gateway.successRequests += totals.successRequests;
      gateway.failedRequests += totals.failedRequests;
      gateway.rateLimitedRequests += totals.rateLimitedRequests;
    }
    return { byProvider, gateway };
  }

  async reset(): Promise<void> {
    const providers = (await this.redis.smembers(INDEX_KEY)) ?? [];
    const now = this.currentHour();
    for (const providerId of providers) {
      for (let h = now - WINDOW_HOURS; h <= now; h++) {
        await this.redis.del(this.hourKey(providerId, h));
      }
    }
    await this.redis.del(INDEX_KEY);
  }
}
