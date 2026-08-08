import type { NextFunction, Request, Response } from "express";
import { freellmError } from "../errors/index.js";
import { getStores } from "../stores/create-stores.js";
import type { IdentifierLimiterStore } from "../stores/identifier-limiter/types.js";

/**
 * Per-identifier rate-limit middleware.
 *
 * Reads the `X-FreeLLM-Identifier` header, sanitizes it, and buckets
 * each request against a sliding-window limiter keyed on the result.
 */

const SAFE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const EXPLICITLY_NULL = new Set(["undefined", "null", ""]);

let limiter: IdentifierLimiterStore | null = null;

function getLimiter(): IdentifierLimiterStore {
  if (!limiter) {
    limiter = getStores().createIdentifierLimiter();
  }
  return limiter;
}

export async function resetIdentifierLimiter(): Promise<void> {
  await getLimiter().reset();
}

export async function identifierLimiterSize(): Promise<number> {
  return getLimiter().size();
}

/** Test helper: replace limiter instance. */
export function setIdentifierLimiter(next: IdentifierLimiterStore): void {
  limiter = next;
}

export async function identifierLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.path === "/healthz" || req.path === "/api/healthz") {
    next();
    return;
  }

  const raw = req.header("x-freellm-identifier");
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const normalized = trimmed.toLowerCase();

  let identifier: string;
  if (trimmed.length === 0 || EXPLICITLY_NULL.has(normalized)) {
    const ip = req.ip ?? "unknown";
    identifier = `ip:${ip}`;
  } else if (!SAFE_PATTERN.test(trimmed)) {
    next(
      freellmError({
        code: "invalid_request",
        message: "X-FreeLLM-Identifier must match ^[A-Za-z0-9_.:-]{1,128}$ or be omitted.",
      }),
    );
    return;
  } else {
    identifier = trimmed;
  }

  const result = await getLimiter().checkAndRecord(identifier);

  res.setHeader("X-FreeLLM-Identifier", result.identifier);
  res.setHeader("X-FreeLLM-Identifier-Remaining", String(result.remaining));
  res.setHeader("X-FreeLLM-Identifier-Reset", String(result.resetAfterMs));

  if (!result.allowed) {
    next(
      freellmError({
        code: "identifier_rate_limited",
        message: `Identifier "${result.identifier}" exceeded its rate limit. Retry in ${Math.ceil(result.resetAfterMs / 1000)}s.`,
        retry_after_ms: result.resetAfterMs,
      }),
    );
    return;
  }

  next();
}
