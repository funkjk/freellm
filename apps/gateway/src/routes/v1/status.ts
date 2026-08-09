import { type IRouter, type NextFunction, Router } from "express";
import { freellmError } from "../../errors/index.js";
import {
  MAX_TTL_SECONDS,
  MIN_SECRET_BYTES,
  isBrowserTokenEnabled,
} from "../../features/browser-tokens.js";
import { getVirtualKeyStore } from "../../features/virtual-keys.js";
import { adminAuth } from "../../middleware/admin-auth.js";
import { validate } from "../../middleware/validate.js";
import type { ProviderAdapter } from "../../providers/types.js";
import {
  router as gatewayRouter,
  registry,
  setRoutingStrategy,
} from "../../routing/index.js";
import { updateProviderSchema, updateRoutingSchema } from "../../schemas.js";
import { getStores } from "../../stores/create-stores.js";
import { emptyOutcomeTotals } from "../../stores/request-metrics/types.js";
import type { BrowserTokensInfo, ProviderStatusInfo, RoutingStrategy } from "../../types.js";

function browserTokensInfo(): BrowserTokensInfo {
  return {
    enabled: isBrowserTokenEnabled(),
    minSecretBytes: MIN_SECRET_BYTES,
    maxTtlSeconds: MAX_TTL_SECONDS,
  };
}

async function buildGatewayStatus() {
  const { byProvider: outcomeByProvider, gateway: outcomes } =
    await gatewayRouter.requestLog.getOutcomeTotals();
  const recentRequests = await gatewayRouter.requestLog.getRecent(50);
  const { byProvider, gateway } = await gatewayRouter.usageTracker.getAllTotals();
  const cacheStats = await gatewayRouter.cache.getStats();

  return {
    routingStrategy: gatewayRouter.strategy,
    totalRequests: outcomes.totalRequests,
    successRequests: outcomes.successRequests,
    failedRequests: outcomes.failedRequests + outcomes.rateLimitedRequests,
    providers: await registry.getStatusAll(byProvider, outcomeByProvider),
    recentRequests,
    usage: gateway,
    cache: cacheStats,
    browserTokens: browserTokensInfo(),
  };
}

async function providerStatusPayload(provider: ProviderAdapter): Promise<ProviderStatusInfo> {
  const live = provider.getStats();
  const keys = await provider.getKeysStatus();
  const usage = await gatewayRouter.usageTracker.getTotals(provider.id);
  const modelStatus = await provider.getModelsStatus();
  const { byProvider } = await gatewayRouter.requestLog.getOutcomeTotals();
  const outcomes = byProvider[provider.id] ?? emptyOutcomeTotals();
  return {
    id: provider.id,
    name: provider.name,
    enabled: provider.isEnabled(),
    disabled: await provider.isManuallyDisabled(),
    circuitBreakerState: await provider.getCircuitBreakerState(),
    totalRequests: outcomes.totalRequests,
    successRequests: outcomes.successRequests,
    failedRequests: outcomes.failedRequests + outcomes.rateLimitedRequests,
    rateLimitedRequests: outcomes.rateLimitedRequests,
    lastError: live.lastError ?? null,
    lastUsedAt: live.lastUsedAt ?? null,
    models: provider.models.map((m) => m.id),
    keyCount: keys.length,
    keysAvailable: keys.filter((k) => !k.rateLimited).length,
    keys,
    rateLimitScope: provider.rateLimitScope,
    modelStatus: modelStatus.length > 0 ? modelStatus : undefined,
    usage,
  };
}

const statusRouter: IRouter = Router();

statusRouter.post("/providers/:providerId/reset", adminAuth);
statusRouter.post("/reset", adminAuth);
statusRouter.patch("/providers/:providerId", adminAuth);
statusRouter.patch("/routing", adminAuth);
statusRouter.get("/virtual-keys", adminAuth);

statusRouter.get("/", async (_req, res) => {
  res.json(await buildGatewayStatus());
});

statusRouter.post("/providers/:providerId/reset", async (req, res, next: NextFunction) => {
  const providerId = String(req.params.providerId);
  const provider = registry.getById(providerId);

  if (!provider) {
    next(
      freellmError({
        code: "provider_not_found",
        message: `Provider not found: ${providerId}`,
      }),
    );
    return;
  }

  // Clears circuit breaker + Redis/memory rate-limit cooldowns, streaks, windows.
  await provider.resetCircuitBreaker();
  res.json(await providerStatusPayload(provider));
});

/** Reset routing state for every configured provider (CB + rate-limit artifacts). */
statusRouter.post("/reset", async (_req, res) => {
  const providers = registry.getAll();
  for (const provider of providers) {
    await provider.resetCircuitBreaker();
  }
  const status = await buildGatewayStatus();
  res.json({
    reset: providers.map((p) => p.id),
    providers: status.providers,
  });
});

statusRouter.patch(
  "/providers/:providerId",
  validate(updateProviderSchema),
  async (req, res, next: NextFunction) => {
    const providerId = String(req.params.providerId);
    const provider = registry.getById(providerId);

    if (!provider) {
      next(
        freellmError({
          code: "provider_not_found",
          message: `Provider not found: ${providerId}`,
        }),
      );
      return;
    }

    const { disabled } = req.body as { disabled: boolean };
    await getStores().providerDisable.setDisabled(provider.id, disabled);
    res.json(await providerStatusPayload(provider));
  },
);

statusRouter.get("/virtual-keys", async (_req, res) => {
  const store = getVirtualKeyStore();
  const now = Date.now();
  const keys = await Promise.all(
    store.list().map(async (key) => {
      const usage = await store.usage(key.id, now);
      const maskedId =
        key.id.length <= 12 ? key.id : `${key.id.slice(0, 12)}...${key.id.slice(-4)}`;
      const expiresAtMs = key.expiresAt ? Date.parse(key.expiresAt) : null;
      const expired = expiresAtMs != null && Number.isFinite(expiresAtMs) && now > expiresAtMs;
      return {
        maskedId,
        label: key.label,
        allowedModels: key.allowedModels ?? null,
        expiresAt: key.expiresAt ?? null,
        expired,
        dailyRequestCap: key.dailyRequestCap ?? null,
        dailyTokenCap: key.dailyTokenCap ?? null,
        requestsInWindow: usage?.requestsInWindow ?? 0,
        tokensInWindow: usage?.tokensInWindow ?? 0,
        requestCapRemaining: usage?.requestCapRemaining ?? null,
        tokenCapRemaining: usage?.tokenCapRemaining ?? null,
      };
    }),
  );
  res.json({
    softCapWarning:
      "Counters use the configured state backend (memory or Redis), rolling 24h. Not a billing system.",
    count: keys.length,
    keys,
  });
});

statusRouter.patch("/routing", validate(updateRoutingSchema), async (req, res) => {
  const { strategy } = req.body as { strategy: RoutingStrategy };
  await setRoutingStrategy(strategy);
  res.json(await buildGatewayStatus());
});

export default statusRouter;
