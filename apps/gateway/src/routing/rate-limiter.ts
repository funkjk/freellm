/** @deprecated Use stores/rate-limiter — kept as a re-export for compatibility. */
export {
  MemoryRateLimiterStore as RateLimiter,
  PROVIDER_WINDOW_CONFIGS,
  FALLBACK_WINDOW_CONFIG as FALLBACK_CONFIG,
} from "../stores/rate-limiter/memory.js";
export type { WindowConfig, WindowStats } from "../stores/rate-limiter/types.js";
