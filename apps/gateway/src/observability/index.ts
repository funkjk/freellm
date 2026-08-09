import { ResponseCache } from "../routing/cache.js";
import type { CacheBackend } from "../stores/cache/types.js";
import type { RequestLogStore } from "../stores/request-log/types.js";
import type { RequestMetricsStore } from "../stores/request-metrics/types.js";
import type { UsageTrackerStore } from "../stores/usage/types.js";
import { RequestLog } from "./request-log.js";
import { UsageTracker } from "./usage-tracker.js";

export class ObservabilityStore {
  readonly requestLog: RequestLog;
  readonly usageTracker: UsageTracker;
  readonly cache: ResponseCache;

  constructor(opts?: {
    cacheBackend?: CacheBackend;
    usageStore?: UsageTrackerStore;
    requestLogStore?: RequestLogStore;
    requestMetrics?: RequestMetricsStore;
  }) {
    this.requestLog = new RequestLog({
      store: opts?.requestLogStore,
      metrics: opts?.requestMetrics,
    });
    this.usageTracker = new UsageTracker(opts?.usageStore);
    this.cache = new ResponseCache(opts?.cacheBackend);
  }
}
