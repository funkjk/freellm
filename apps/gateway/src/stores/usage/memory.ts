import type { TokenUsageTotals, UsageTrackerStore } from "./types.js";

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 24;

interface HourlyBucket {
  hour: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
}

export class MemoryUsageTrackerStore implements UsageTrackerStore {
  private buckets = new Map<string, HourlyBucket[]>();

  private currentHour(): number {
    return Math.floor(Date.now() / HOUR_MS);
  }

  private prune(existing: HourlyBucket[]): HourlyBucket[] {
    const cutoff = this.currentHour() - WINDOW_HOURS;
    return existing.filter((b) => b.hour > cutoff);
  }

  async record(
    providerId: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<void> {
    const now = this.currentHour();
    const fresh = this.prune(this.buckets.get(providerId) ?? []);

    let current = fresh.find((b) => b.hour === now);
    if (!current) {
      current = { hour: now, promptTokens: 0, completionTokens: 0, requestCount: 0 };
      fresh.push(current);
    }
    current.promptTokens += promptTokens;
    current.completionTokens += completionTokens;
    current.requestCount += 1;

    this.buckets.set(providerId, fresh);
  }

  async getTotals(providerId: string): Promise<TokenUsageTotals> {
    const fresh = this.prune(this.buckets.get(providerId) ?? []);
    const promptTokens = fresh.reduce((s, b) => s + b.promptTokens, 0);
    const completionTokens = fresh.reduce((s, b) => s + b.completionTokens, 0);
    const requestCount = fresh.reduce((s, b) => s + b.requestCount, 0);
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
    const byProvider: Record<string, TokenUsageTotals> = {};
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalRequests = 0;

    for (const providerId of this.buckets.keys()) {
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
    this.buckets.clear();
  }
}
