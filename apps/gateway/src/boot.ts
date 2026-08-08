import { MIN_SECRET_BYTES } from "./features/browser-tokens.js";
import { VirtualKeysError, initVirtualKeys } from "./features/virtual-keys.js";
import { logger } from "./logger.js";
import { bootstrapRouting } from "./routing/index.js";
import { PROVIDER_PRIVACY, daysSinceVerified } from "./routing/privacy.js";
import { resolveStateBackend } from "./stores/types.js";

/**
 * Shared boot sequence for long-running server and serverless entrypoints.
 * Initializes state backend, then virtual keys (which may use Redis counters).
 */
export async function bootGateway(): Promise<void> {
  const backend = resolveStateBackend();
  await bootstrapRouting(true);
  logger.info({ backend }, "state backend ready");

  if (process.env.NODE_ENV === "production" && !process.env.FREELLM_API_KEY) {
    logger.warn(
      "FREELLM_API_KEY is not set -- gateway is open to the internet without authentication",
    );
  }

  const browserTokenSecret = process.env.FREELLM_TOKEN_SECRET;
  if (browserTokenSecret) {
    const bytes = Buffer.byteLength(browserTokenSecret, "utf8");
    if (bytes < MIN_SECRET_BYTES) {
      throw new Error(
        `FREELLM_TOKEN_SECRET is too short (${bytes} bytes, min ${MIN_SECRET_BYTES})`,
      );
    }
    logger.info({ bytes }, "browser tokens enabled");
  } else {
    logger.warn(
      "FREELLM_TOKEN_SECRET not set, browser tokens disabled (/v1/tokens/issue will return 400)",
    );
  }

  try {
    const vkStore = initVirtualKeys();
    if (vkStore.size() > 0) {
      logger.warn(
        { keyCount: vkStore.size(), backend },
        "virtual key caps are SOFT (counters use configured state backend). Not a billing system.",
      );
    }
  } catch (err) {
    if (err instanceof VirtualKeysError) {
      throw new Error(`failed to load virtual keys: ${err.message}`);
    }
    throw err;
  }

  for (const [id, entry] of Object.entries(PROVIDER_PRIVACY)) {
    const age = daysSinceVerified(entry);
    if (age > 90) {
      logger.warn(
        { provider: id, last_verified: entry.last_verified, days_stale: age },
        "privacy catalog entry is older than 90 days -- re-verify against provider ToS",
      );
    }
  }
}
