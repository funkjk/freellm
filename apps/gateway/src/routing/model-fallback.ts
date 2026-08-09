import { MODEL_FALLBACK_CHAINS } from "../config.js";
import type { ProviderAdapter } from "../providers/types.js";

/**
 * Ordered candidate models to try for `primary`, wrapping within its chain.
 * Solo models (not in any chain) yield `[primary]` only.
 */
export function fallbackCandidates(primary: string): string[] {
  const chain = MODEL_FALLBACK_CHAINS.find((c) => c.includes(primary));
  if (!chain) return [primary];
  const idx = chain.indexOf(primary);
  if (idx < 0) return [primary];
  return [...chain.slice(idx), ...chain.slice(0, idx)];
}

/**
 * Pick the next concrete model this provider should try, skipping already
 * failed ids and (when vision is required) non-vision catalog entries.
 */
export function nextFallbackModel(
  provider: ProviderAdapter,
  primary: string,
  skipped: ReadonlySet<string>,
  requiresVision = false,
): string | undefined {
  const owned = new Set(provider.models.map((m) => m.id));
  for (const candidate of fallbackCandidates(primary)) {
    if (skipped.has(candidate)) continue;
    if (!owned.has(candidate)) continue;
    if (requiresVision) {
      const meta = provider.models.find((m) => m.id === candidate);
      if (!meta?.supportsVision) continue;
    }
    return candidate;
  }
  return undefined;
}
