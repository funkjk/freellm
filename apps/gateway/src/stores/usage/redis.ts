import type { Redis } from "@upstash/redis";
import type { TokenUsageTotals, UsageTrackerStore } from "./types.js";

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 24;
const KEY_PREFIX = "freellm:usage:";
const INDEX_KEY = "freellm:usage:providers";

export class RedisUsageTrackerStore implements UsageTrackerStore {
  constructor(private redis: Redis) {}

  private currentHour(): number {
    return Math.floor(Date.now() / HOUR_MS);
  }

  private hourKey(providerId: string, hour: number): string {
    return `${KEY_PREFIX}${providerId}:${hour}`;
  }

  async record(
    providerId: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<void> {
    const hour = this.currentHour();
    const key = this.hourKey(providerId, hour);
    await this.redis.hincrby(key, "promptTokens", promptTokens);
    await this.redis.hincrby(key, "completionTokens", completionTokens);
    await this.redis.hincrby(key, "requestCount", 1);
    await this.redis.pexpire(key, WINDOW_HOURS * HOUR_MS);
    await this.redis.sadd(INDEX_KEY, providerId);
  }

  async getTotals(providerId: string): Promise<TokenUsageTotals> {
    const now = this.currentHour();
    let promptTokens = 0;
    let completionTokens = 0;
    let requestCount = 0;
    for (let h = now - WINDOW_HOURS + 1; h <= now; h++) {
      const raw = await this.redis.hgetall<Record<string, string>>(this.hourKey(providerId, h));
      if (!raw) continue;
      promptTokens += Number(raw.promptTokens ?? 0);
      completionTokens += Number(raw.completionTokens ?? 0);
      requestCount += Number(raw.requestCount ?? 0);
    }
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      requestCount,
    };
  }

  async getAllTotals(): Promise<{
    byProvider: Record<string, TokenUsageTotals>;
    gateway: TokenUsageTotals;
  }> {
    const providers = (await this.redis.smembers(INDEX_KEY)) ?? [];
    const byProvider: Record<string, TokenUsageTotals> = {};
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalRequests = 0;
    for (const providerId of providers) {
      const totals = await this.getTotals(providerId);
      byProvider[providerId] = totals;
      totalPrompt += totals.promptTokens;
      totalCompletion += totals.completionTokens;
      totalRequests += totals.requestCount;
    }
    return {
      byProvider,
      gateway: {
        promptTokens: totalPrompt,
        completionTokens: totalCompletion,
        totalTokens: totalPrompt + totalCompletion,
        requestCount: totalRequests,
      },
    };
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
