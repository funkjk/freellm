import {
  type OutcomeKind,
  type OutcomeTotals,
  type RequestMetricsStore,
  emptyOutcomeTotals,
} from "./types.js";

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 24;

interface HourlyBucket {
  hour: number;
  success: number;
  failed: number;
  rateLimited: number;
}

export class MemoryRequestMetricsStore implements RequestMetricsStore {
  private buckets = new Map<string, HourlyBucket[]>();

  private currentHour(): number {
    return Math.floor(Date.now() / HOUR_MS);
  }

  private prune(existing: HourlyBucket[]): HourlyBucket[] {
    const cutoff = this.currentHour() - WINDOW_HOURS;
    return existing.filter((b) => b.hour > cutoff);
  }

  async record(providerId: string, kind: OutcomeKind): Promise<void> {
    const now = this.currentHour();
    const fresh = this.prune(this.buckets.get(providerId) ?? []);
    let current = fresh.find((b) => b.hour === now);
    if (!current) {
      current = { hour: now, success: 0, failed: 0, rateLimited: 0 };
      fresh.push(current);
    }
    if (kind === "success") current.success += 1;
    else if (kind === "rate_limited") current.rateLimited += 1;
    else current.failed += 1;
    this.buckets.set(providerId, fresh);
  }

  async getTotals(providerId: string): Promise<OutcomeTotals> {
    const fresh = this.prune(this.buckets.get(providerId) ?? []);
    const successRequests = fresh.reduce((s, b) => s + b.success, 0);
    const failedRequests = fresh.reduce((s, b) => s + b.failed, 0);
    const rateLimitedRequests = fresh.reduce((s, b) => s + b.rateLimited, 0);
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
    const byProvider: Record<string, OutcomeTotals> = {};
    const gateway = emptyOutcomeTotals();
    for (const providerId of this.buckets.keys()) {
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
    this.buckets.clear();
  }
}
