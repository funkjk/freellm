import type { Redis } from "@upstash/redis";
import type { CheckResult, IdentifierLimiterConfig, IdentifierLimiterStore } from "./types.js";

const KEY_PREFIX = "freellm:id:";

/**
 * Atomic check-and-record via EVAL.
 * Returns [allowed (0|1), remaining, resetAfterMs].
 */
const CHECK_AND_RECORD_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
local windowStart = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
local count = redis.call('ZCARD', key)
if count >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = now
  if oldest[2] then oldestScore = tonumber(oldest[2]) end
  local resetAfter = math.max(0, oldestScore + windowMs - now)
  redis.call('PEXPIRE', key, windowMs * 2)
  return {0, 0, resetAfter}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs * 2)
local remaining = max - (count + 1)
return {1, remaining, windowMs}
`;

export class RedisIdentifierLimiterStore implements IdentifierLimiterStore {
  constructor(
    private redis: Redis,
    private config: IdentifierLimiterConfig,
  ) {}

  async checkAndRecord(identifier: string, now: number = Date.now()): Promise<CheckResult> {
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    const result = (await this.redis.eval(
      CHECK_AND_RECORD_LUA,
      [KEY_PREFIX + identifier],
      [String(now), String(this.config.windowMs), String(this.config.max), member],
    )) as [number, number, number];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      resetAfterMs: result[2],
      identifier,
    };
  }

  async size(): Promise<number> {
    // Approximate: scan is expensive; return 0 for metrics when redis-backed.
    return 0;
  }

  async reset(): Promise<void> {
    // Best-effort: operators should flush via Upstash console for full wipe.
    // No SCAN in Upstash REST without cursor loops; leave as no-op for tests
    // that only use memory backend for reset().
  }
}
