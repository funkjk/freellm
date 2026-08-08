import { ObservabilityStore } from "../observability/index.js";
import { initStores } from "../stores/create-stores.js";
import { ProviderRegistry } from "./registry.js";
import { GatewayRouter } from "./router.js";

export { AllProvidersExhaustedError, ProviderClientError } from "./router.js";
export { ObservabilityStore } from "../observability/index.js";
export type * from "../types.js";

export let registry = new ProviderRegistry();
export let obs = new ObservabilityStore();
export let router = new GatewayRouter(registry, obs);

let bootstrapped = false;

/**
 * Initialize the configured state backend and rebuild registry/router/obs
 * so providers and cache bind to Redis (or refreshed memory stores).
 */
export async function bootstrapRouting(force = false): Promise<void> {
  if (bootstrapped && !force) return;
  const stores = await initStores();
  obs = new ObservabilityStore({
    cacheBackend: stores.cacheBackend,
    usageStore: stores.usageTracker,
  });
  registry = new ProviderRegistry();
  router = new GatewayRouter(registry, obs);
  bootstrapped = true;
}
