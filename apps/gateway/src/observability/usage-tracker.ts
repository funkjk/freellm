/**
 * Tracks token usage per provider over a rolling 24-hour window.
 * Persistence is delegated to a UsageTrackerStore.
 */

import type { UsageTrackerStore } from "../stores/usage/types.js";
import { MemoryUsageTrackerStore } from "../stores/usage/memory.js";
import type { TokenUsageTotals } from "../stores/usage/types.js";

export type { TokenUsageTotals };

export class UsageTracker {
  constructor(private store: UsageTrackerStore = new MemoryUsageTrackerStore()) {}

  async record(providerId: string, promptTokens: number, completionTokens: number): Promise<void> {
    await this.store.record(providerId, promptTokens, completionTokens);
  }

  async getTotals(providerId: string): Promise<TokenUsageTotals> {
    return this.store.getTotals(providerId);
  }

  async getAllTotals(): Promise<{
    byProvider: Record<string, TokenUsageTotals>;
    gateway: TokenUsageTotals;
  }> {
    return this.store.getAllTotals();
  }

  async reset(): Promise<void> {
    await this.store.reset();
  }
}
