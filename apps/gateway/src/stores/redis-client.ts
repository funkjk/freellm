import { Redis } from "@upstash/redis";
import { logger } from "../logger.js";

/**
 * Diagnostic helpers so we can see exactly what Vercel/env delivered.
 * Do not mutate secrets here — logging only.
 */
function describeEnvString(value: string): {
  length: number;
  firstCharCode: number | null;
  lastCharCode: number | null;
  startsWithHttps: boolean;
  startsWithTtps: boolean;
  hasLeadingWhitespace: boolean;
  hasTrailingWhitespace: boolean;
} {
  return {
    length: value.length,
    firstCharCode: value.length > 0 ? value.charCodeAt(0) : null,
    lastCharCode: value.length > 0 ? value.charCodeAt(value.length - 1) : null,
    startsWithHttps: value.startsWith("https://"),
    startsWithTtps: value.startsWith("ttps://"),
    hasLeadingWhitespace: /^\s/.test(value),
    hasTrailingWhitespace: /\s$/.test(value),
  };
}

export function createRedisClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "FREELLM_STATE_BACKEND=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
    );
  }

  // Log the URL in full — if the leading "h" (or anything else) is missing,
  // that means the value was already wrong in process.env (Vercel/env pipeline),
  // not stripped by this client.
  logger.info(
    {
      upstashRedisRestUrl: url,
      upstashRedisRestUrlMeta: describeEnvString(url),
      upstashRedisRestTokenMeta: {
        ...describeEnvString(token),
        // Never log the token itself; prefix is enough to spot truncation.
        prefix: token.slice(0, 4),
      },
    },
    "Upstash Redis env as received from process.env",
  );

  return new Redis({ url, token });
}
