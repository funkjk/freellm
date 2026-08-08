import type { Redis } from "@upstash/redis";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { freellmError } from "../errors/index.js";
import { getStores } from "../stores/create-stores.js";

const windowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const max = Number.parseInt(process.env.RATE_LIMIT_RPM ?? "60", 10);

/**
 * Minimal express-rate-limit Store backed by Upstash Redis.
 * Implements the subset used by express-rate-limit v7.
 */
class UpstashRateLimitStore {
  prefix = "freellm:iprl:";
  constructor(private redis: Redis) {}

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date | undefined }> {
    const redisKey = this.prefix + key;
    const totalHits = await this.redis.incr(redisKey);
    if (totalHits === 1) {
      await this.redis.pexpire(redisKey, windowMs);
    }
    const pttl = await this.redis.pttl(redisKey);
    const resetTime = new Date(Date.now() + Math.max(pttl, 0));
    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    await this.redis.decr(this.prefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}

function buildClientRateLimit() {
  const stores = getStores();
  const store =
    stores.backend === "redis" && stores.redis
      ? new UpstashRateLimitStore(stores.redis as Redis)
      : undefined;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(store ? { store: store as never } : {}),
    skip: (req) => {
      return req.path === "/healthz" || req.path === "/api/healthz";
    },
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(
        freellmError({
          code: "client_rate_limited",
          message: `Client rate limit exceeded. Max ${max} requests per ${windowMs / 1000}s.`,
          retry_after_ms: windowMs,
        }),
      );
    },
  });
}

/** Lazily constructed so initStores() can run first. */
let _middleware: ReturnType<typeof rateLimit> | null = null;

export function clientRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!_middleware) {
    _middleware = buildClientRateLimit();
  }
  _middleware(req, res, next);
}

/** Test helper. */
export function resetClientRateLimit(): void {
  _middleware = null;
}
