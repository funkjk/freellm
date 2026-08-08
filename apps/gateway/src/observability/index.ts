import { ResponseCache } from "../routing/cache.js";
import type { CacheBackend } from "../stores/cache/types.js";
import type { UsageTrackerStore } from "../stores/usage/types.js";
import { RequestLog } from "./request-log.js";
import { UsageTracker } from "./usage-tracker.js";

export class ObservabilityStore {
  readonly requestLog: RequestLog;
  readonly usageTracker: UsageTracker;
  readonly cache: ResponseCache;

  constructor(opts?: { cacheBackend?: CacheBackend; usageStore?: UsageTrackerStore }) {
    this.requestLog = new RequestLog();
    this.usageTracker = new UsageTracker(opts?.usageStore);
    this.cache = new ResponseCache(opts?.cacheBackend);
  }
}
