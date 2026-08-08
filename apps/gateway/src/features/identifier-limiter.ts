/**
 * Per-identifier sliding-window rate limiter.
 * Thin facade over MemoryIdentifierLimiterStore for tests and middleware.
 */

export type {
  CheckResult,
  IdentifierLimiterConfig,
} from "../stores/identifier-limiter/types.js";
export {
  MemoryIdentifierLimiterStore as IdentifierLimiter,
  parseIdentifierLimitEnv,
} from "../stores/identifier-limiter/memory.js";
