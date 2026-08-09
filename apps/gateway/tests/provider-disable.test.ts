import { beforeEach, describe, expect, it } from "vitest";
import { freellmError, isFreeLLMError } from "../src/errors/index.js";
import type { ProviderAdapter } from "../src/providers/types.js";
import { GatewayRouter } from "../src/routing/router.js";
import type { ProviderRegistry } from "../src/routing/registry.js";
import { MemoryProviderDisableStore } from "../src/stores/provider-disable/memory.js";
import { getStores, setStores } from "../src/stores/create-stores.js";
import type {
  ChatCompletionRequest,
  CircuitBreakerState,
  KeyStatus,
  ModelObject,
  ProviderStats,
} from "../src/types.js";

describe("MemoryProviderDisableStore", () => {
  it("toggles and lists disabled providers", async () => {
    const store = new MemoryProviderDisableStore();
    expect(await store.isDisabled("groq")).toBe(false);
    await store.setDisabled("groq", true);
    expect(await store.isDisabled("groq")).toBe(true);
    expect(await store.listDisabled()).toEqual(["groq"]);
    await store.setDisabled("groq", false);
    expect(await store.isDisabled("groq")).toBe(false);
    expect(await store.listDisabled()).toEqual([]);
  });
});

class FakeProvider implements ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly models: ModelObject[];
  readonly supportsStreamUsage = false;
  readonly supportsTools = true;
  readonly rateLimitScope = "key" as const;
  callCount = 0;

  constructor(id: string, modelIds: string[]) {
    this.id = id;
    this.name = id;
    this.models = modelIds.map((m) => ({
      id: m,
      object: "model" as const,
      created: 0,
      owned_by: id,
      provider: id,
    }));
  }

  isEnabled(): boolean {
    return true;
  }
  async isManuallyDisabled(): Promise<boolean> {
    return getStores().providerDisable.isDisabled(this.id);
  }
  async isAvailable(): Promise<boolean> {
    return !(await this.isManuallyDisabled());
  }
  async isAvailableForModel(_modelId: string): Promise<boolean> {
    return this.isAvailable();
  }
  getStats(): ProviderStats {
    return { totalRequests: 0, successRequests: 0, failedRequests: 0, rateLimitedRequests: 0 };
  }
  async getCircuitBreakerState(): Promise<CircuitBreakerState> {
    return "closed";
  }
  async getKeysStatus(): Promise<KeyStatus[]> {
    return [
      { index: 0, rateLimited: false, requestsInWindow: 0, maxRequests: 30, retryAfterMs: null },
    ];
  }
  async getModelsStatus() {
    return [];
  }
  async complete(req: ChatCompletionRequest): Promise<Response> {
    this.callCount++;
    return new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: req.model,
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  async onSuccess(): Promise<void> {}
  async onRateLimit(): Promise<void> {}
  async onError(): Promise<void> {}
  async resetCircuitBreaker(): Promise<void> {}
}

function makeRegistry(providers: FakeProvider[]): ProviderRegistry {
  return {
    getAll: () => providers,
    getEnabled: () => providers,
    getAvailable: async () => {
      const out: FakeProvider[] = [];
      for (const p of providers) {
        if (await p.isAvailable()) out.push(p);
      }
      return out;
    },
    getById: (id: string) => providers.find((p) => p.id === id),
    getAllModels: () => providers.flatMap((p) => p.models),
    getProviderForMetaModel: async () => {
      for (const p of providers) {
        if (await p.isAvailable()) return p;
      }
      return undefined;
    },
    getStatusAll: async () => [],
  } as unknown as ProviderRegistry;
}

describe("router respects operator disable", () => {
  beforeEach(() => {
    const stores = getStores();
    setStores({
      ...stores,
      providerDisable: new MemoryProviderDisableStore(),
    });
  });

  it("rejects direct model requests when the only owner is disabled", async () => {
    const groq = new FakeProvider("groq", ["groq/llama-3.3-70b-versatile"]);
    const router = new GatewayRouter(makeRegistry([groq]));
    await getStores().providerDisable.setDisabled("groq", true);

    try {
      await router.route({
        model: "groq/llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "hi" }],
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(isFreeLLMError(err)).toBe(true);
      expect((err as ReturnType<typeof freellmError>).code).toBe("provider_disabled");
    }
    expect(groq.callCount).toBe(0);
  });

  it("skips disabled providers for meta-models and uses the next one", async () => {
    const groq = new FakeProvider("groq", ["groq/llama-3.3-70b-versatile"]);
    const gemini = new FakeProvider("gemini", ["gemini/gemini-flash-latest"]);
    const router = new GatewayRouter(makeRegistry([groq, gemini]));
    await getStores().providerDisable.setDisabled("groq", true);

    const result = await router.route({
      model: "free",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider.id).toBe("gemini");
    expect(groq.callCount).toBe(0);
    expect(gemini.callCount).toBe(1);
  });
});
