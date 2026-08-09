import { describe, expect, it } from "vitest";
import type { ProviderAdapter } from "../src/providers/types.js";
import { fallbackCandidates, nextFallbackModel } from "../src/routing/model-fallback.js";
import type { ModelObject } from "../src/types.js";

function stubProvider(modelIds: string[], visionIds: string[] = []): ProviderAdapter {
  const models: ModelObject[] = modelIds.map((id) => ({
    id,
    object: "model",
    created: 0,
    owned_by: "test",
    provider: "test",
    ...(visionIds.includes(id) ? { supportsVision: true } : {}),
  }));
  return {
    id: "test",
    name: "test",
    models,
    supportsStreamUsage: false,
    supportsTools: true,
    rateLimitScope: "model",
    isEnabled: () => true,
    isManuallyDisabled: async () => false,
    getStats: () => ({
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      rateLimitedRequests: 0,
    }),
    getCircuitBreakerState: async () => "closed",
    isAvailable: async () => true,
    isAvailableForModel: async () => true,
    getKeysStatus: async () => [],
    complete: async () => new Response(),
    onSuccess: async () => {},
    onRateLimit: async () => {},
    onError: async () => {},
    resetCircuitBreaker: async () => {},
  };
}

describe("fallbackCandidates", () => {
  it("starts at the requested model and wraps the Gemini Flash chain", () => {
    const c = fallbackCandidates("gemini/gemini-3.5-flash");
    expect(c[0]).toBe("gemini/gemini-3.5-flash");
    expect(c).toContain("gemini/gemini-flash-latest");
    expect(c).toContain("gemini/gemini-3.6-flash");
  });

  it("returns the primary alone when it is not in any chain", () => {
    expect(fallbackCandidates("unknown/model")).toEqual(["unknown/model"]);
  });
});

describe("nextFallbackModel", () => {
  it("skips already-tried models and models the provider does not own", () => {
    const provider = stubProvider([
      "gemini/gemini-flash-latest",
      "gemini/gemini-3.5-flash",
      "gemini/gemini-3.5-flash-lite",
    ]);
    const next = nextFallbackModel(
      provider,
      "gemini/gemini-flash-latest",
      new Set(["gemini/gemini-flash-latest", "gemini/gemini-3.6-flash"]),
    );
    expect(next).toBe("gemini/gemini-3.5-flash");
  });

  it("skips non-vision models when requiresVision is set", () => {
    const provider = stubProvider(
      ["gemini/gemini-flash-latest", "gemini/gemini-3.5-flash-lite"],
      ["gemini/gemini-3.5-flash-lite"],
    );
    const next = nextFallbackModel(
      provider,
      "gemini/gemini-flash-latest",
      new Set(["gemini/gemini-flash-latest"]),
      true,
    );
    expect(next).toBe("gemini/gemini-3.5-flash-lite");
  });
});
