import { randomUUID } from "node:crypto";
import type { RequestLogStore } from "../stores/request-log/types.js";
import { MemoryRequestLogStore } from "../stores/request-log/memory.js";
import {
  outcomeKindFromStatus,
  type RequestMetricsStore,
} from "../stores/request-metrics/types.js";
import { MemoryRequestMetricsStore } from "../stores/request-metrics/memory.js";
import type { RequestLogEntry, RequestStatus } from "../types.js";
import type { OutcomeTotals } from "../stores/request-metrics/types.js";
import { emptyOutcomeTotals } from "../stores/request-metrics/types.js";
import { logger } from "../logger.js";

const UNKNOWN_PROVIDER = "_unknown";

export class RequestLog {
  private readonly store: RequestLogStore;
  private readonly metrics: RequestMetricsStore;

  constructor(opts?: { store?: RequestLogStore; metrics?: RequestMetricsStore }) {
    this.store = opts?.store ?? new MemoryRequestLogStore();
    this.metrics = opts?.metrics ?? new MemoryRequestMetricsStore();
  }

  add(entry: Omit<RequestLogEntry, "id" | "timestamp">): RequestLogEntry {
    const full: RequestLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    void this.persist(full, entry.status, entry.provider);
    return full;
  }

  private async persist(
    full: RequestLogEntry,
    status: RequestStatus,
    provider: string | null | undefined,
  ): Promise<void> {
    try {
      await this.store.append(full);
      const providerId =
        typeof provider === "string" && provider.length > 0 ? provider : UNKNOWN_PROVIDER;
      await this.metrics.record(providerId, outcomeKindFromStatus(status));
    } catch (err) {
      logger.warn({ err }, "failed to persist request log / metrics");
    }
  }

  async getRecent(limit = 50): Promise<RequestLogEntry[]> {
    return this.store.getRecent(limit);
  }

  async getOutcomeTotals(): Promise<{
    byProvider: Record<string, OutcomeTotals>;
    gateway: OutcomeTotals;
  }> {
    try {
      return await this.metrics.getAllTotals();
    } catch (err) {
      logger.warn({ err }, "failed to read request metrics");
      return { byProvider: {}, gateway: emptyOutcomeTotals() };
    }
  }
}
