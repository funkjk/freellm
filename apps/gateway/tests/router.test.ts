import { beforeEach, describe, expect, it } from "vitest";
import type { ProviderAdapter } from "../src/providers/types.js";
import type { ProviderRegistry } from "../src/routing/registry.js";
import {
  AllProvidersExhaustedError,
  GatewayRouter,
  ProviderClientError,
} from "../src/routing/router.js";
import { StrictModeError } from "../src/routing/strict.js";
import type {
  ChatCompletionRequest,
  CircuitBreakerState,
  KeyStatus,
  ModelObject,
  ProviderStats,
  ProviderStatusInfo,
} from "../src/types.js";

interface FakeOptions {
  id: string;
  models: string[];
  /** Sequence of statuses to return on each call. Defaults to [200]. */
  statuses?: number[];
  /** Body returned for 200 responses. */
  body?: unknown;
  /** Extra response headers to include on each upstream response. */
  extraHeaders?: Record<string, string>;
}

class FakeProvider implements ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly models: ModelObject[];
  readonly supportsStreamUsage = false;
  readonly supportsTools = true;
  readonly rateLimitScope: "key" | "model" = "key";
  callCount = 0;
  lastRetryAfterSeconds: number | undefined = undefined;
  lastModel: string | undefined = undefined;
  private statuses: number[];
  private body: unknown;
  private extraHeaders: Record<string, string>;
  private cbState: CircuitBreakerState = "closed";
  private rateLimited = false;
  private limitedModels = new Set<string>();
  private statsObj: ProviderStats = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
  };

  constructor(opts: FakeOptions & { rateLimitScope?: "key" | "model" }) {
    this.id = opts.id;
    this.name = opts.id;
    this.rateLimitScope = opts.rateLimitScope ?? "key";
    this.models = opts.models.map((m) => ({
      id: m,
      object: "model" as const,
      created: 0,
      owned_by: opts.id,
      provider: opts.id,
      supportsVision: true,
    }));
    this.statuses = opts.statuses ?? [200];
    this.extraHeaders = opts.extraHeaders ?? {};
    this.body = opts.body ?? {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: opts.models[0],
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  }

  isEnabled(): boolean {
    return true;
  }
  async isManuallyDisabled(): Promise<boolean> {
    return false;
  }
  async isAvailable(): Promise<boolean> {
    if (this.rateLimitScope === "model") {
      return this.models.some((m) => !this.limitedModels.has(m.id));
    }
    return !this.rateLimited;
  }
  async isAvailableForModel(modelId: string): Promise<boolean> {
    if (this.rateLimitScope === "model") return !this.limitedModels.has(modelId);
    return !this.rateLimited;
  }
  getStats(): ProviderStats {
    return { ...this.statsObj };
  }
  async getCircuitBreakerState(): Promise<CircuitBreakerState> {
    return this.cbState;
  }
  async getKeysStatus(): Promise<KeyStatus[]> {
    const limited =
      this.rateLimitScope === "model" ? this.limitedModels.size >= this.models.length : this.rateLimited;
    return [
      {
        index: 0,
        rateLimited: limited,
        requestsInWindow: 0,
        maxRequests: 30,
        retryAfterMs: limited ? 5_000 : null,
      },
    ];
  }
  async getModelsStatus() {
    if (this.rateLimitScope !== "model") return [];
    return this.models.map((m) => ({
      id: m.id,
      rateLimited: this.limitedModels.has(m.id),
      requestsInWindow: 0,
      maxRequests: 30,
      retryAfterMs: this.limitedModels.has(m.id) ? 5_000 : null,
    }));
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    this.lastModel = request.model;
    const idx = Math.min(this.callCount, this.statuses.length - 1);
    const status = this.statuses[idx] ?? 500;
    this.callCount++;
    this.statsObj.totalRequests++;
    if (status === 200) {
      const body =
        typeof this.body === "object" && this.body !== null
          ? { ...(this.body as object), model: request.model }
          : this.body;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", ...this.extraHeaders },
      });
    }
    return new Response(JSON.stringify({ error: { message: "upstream error" } }), {
      status,
      headers: { "content-type": "application/json", ...this.extraHeaders },
    });
  }

  async onSuccess(): Promise<void> {
    this.statsObj.successRequests++;
  }
  async onRateLimit(_response: Response, retryAfterSeconds?: number): Promise<void> {
    this.statsObj.rateLimitedRequests++;
    this.lastRetryAfterSeconds = retryAfterSeconds;
    if (this.rateLimitScope === "model" && this.lastModel) {
      this.limitedModels.add(this.lastModel);
    } else {
      this.rateLimited = true;
    }
  }
  async onError(): Promise<void> {
    this.statsObj.failedRequests++;
    this.cbState = "open";
  }
  async resetCircuitBreaker(): Promise<void> {
    this.cbState = "closed";
    this.rateLimited = false;
    this.limitedModels.clear();
  }
}

function fakeRegistry(providers: FakeProvider[]): ProviderRegistry {
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
    getProviderForMetaModel: async (
      _meta: string,
      excluded: Set<string>,
    ): Promise<ProviderAdapter | undefined> => {
      for (const p of providers) {
        if (excluded.has(p.id)) continue;
        if (await p.isAvailable()) return p;
      }
      return undefined;
    },
    getStatusAll: async (): Promise<ProviderStatusInfo[]> =>
      Promise.all(
        providers.map(async (p) => {
          const keys = await p.getKeysStatus();
          return {
            id: p.id,
            name: p.name,
            enabled: p.isEnabled(),
            disabled: await p.isManuallyDisabled(),
            circuitBreakerState: await p.getCircuitBreakerState(),
            totalRequests: p.getStats().totalRequests,
            successRequests: p.getStats().successRequests,
            failedRequests: p.getStats().failedRequests,
            rateLimitedRequests: p.getStats().rateLimitedRequests,
            lastError: null,
            lastUsedAt: null,
            models: p.models.map((m) => m.id),
            keyCount: 1,
            keysAvailable: (await p.isAvailable()) ? 1 : 0,
            keys,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0 },
          };
        }),
      ),
  } as unknown as ProviderRegistry;
}

const baseRequest = (model: string): ChatCompletionRequest => ({
  model,
  messages: [{ role: "user", content: "hi" }],
});

describe("GatewayRouter.complete (non-strict)", () => {
  let router: GatewayRouter;
  let groq: FakeProvider;
  let gemini: FakeProvider;

  beforeEach(() => {
    groq = new FakeProvider({ id: "groq", models: ["groq/llama"] });
    gemini = new FakeProvider({ id: "gemini", models: ["gemini/flash"] });
    router = new GatewayRouter(fakeRegistry([groq, gemini]));
  });

  it("returns meta with reason=direct on first-try success of a concrete model", async () => {
    const { data, meta } = await router.complete(baseRequest("groq/llama"));
    expect(data.choices[0].message.content).toBe("ok");
    expect(meta).toMatchObject({
      provider: "groq",
      resolvedModel: "groq/llama",
      requestedModel: "groq/llama",
      cached: false,
      reason: "direct",
    });
    expect(meta.attempted).toEqual(["groq"]);
  });

  it("marks reason=failover when first provider 500s and second succeeds", async () => {
    groq = new FakeProvider({ id: "groq", models: ["m"], statuses: [500] });
    gemini = new FakeProvider({ id: "gemini", models: ["m"] });
    router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const { meta } = await router.complete(baseRequest("m"));
    expect(meta.provider).toBe("gemini");
    expect(meta.reason).toBe("failover");
    expect(meta.attempted).toEqual(["groq", "gemini"]);
  });

  it("throws AllProvidersExhaustedError when every provider fails", async () => {
    groq = new FakeProvider({ id: "groq", models: ["m"], statuses: [500] });
    gemini = new FakeProvider({ id: "gemini", models: ["m"], statuses: [500] });
    router = new GatewayRouter(fakeRegistry([groq, gemini]));

    await expect(router.complete(baseRequest("m"))).rejects.toBeInstanceOf(
      AllProvidersExhaustedError,
    );
  });

  it("forwards an upstream Retry-After value to the provider cooldown", async () => {
    const slow = new FakeProvider({
      id: "groq",
      models: ["m"],
      statuses: [429, 200],
      extraHeaders: { "retry-after": "7" },
    });
    const backup = new FakeProvider({ id: "gemini", models: ["m"] });
    router = new GatewayRouter(fakeRegistry([slow, backup]));

    await router.complete(baseRequest("m"));
    expect(slow.lastRetryAfterSeconds).toBe(7);
  });

  it("clamps absurd upstream Retry-After values down to the 10 minute ceiling", async () => {
    const absurd = new FakeProvider({
      id: "groq",
      models: ["m"],
      statuses: [429, 200],
      extraHeaders: { "retry-after": "99999999" },
    });
    const backup = new FakeProvider({ id: "gemini", models: ["m"] });
    router = new GatewayRouter(fakeRegistry([absurd, backup]));

    await router.complete(baseRequest("m"));
    // 10 minute ceiling = 600s.
    expect(absurd.lastRetryAfterSeconds).toBe(600);
  });

  it("honors Retry-After on 5xx responses too", async () => {
    const dying = new FakeProvider({
      id: "groq",
      models: ["m"],
      statuses: [503, 200],
      extraHeaders: { "retry-after": "12" },
    });
    const backup = new FakeProvider({ id: "gemini", models: ["m"] });
    router = new GatewayRouter(fakeRegistry([dying, backup]));

    await router.complete(baseRequest("m"));
    expect(dying.lastRetryAfterSeconds).toBe(12);
  });
});

describe("GatewayRouter.complete finish_reason handling", () => {
  function bodyWithFinish(finishReason: string) {
    return {
      id: "fr-test",
      object: "chat.completion",
      created: 0,
      model: "m",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "truncated output" },
          finish_reason: finishReason,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };
  }

  it("does NOT cache a finish_reason=length response (anti-poisoning)", async () => {
    const groq = new FakeProvider({
      id: "groq",
      models: ["m"],
      body: bodyWithFinish("length"),
    });
    const router = new GatewayRouter(fakeRegistry([groq]));

    // First call -> upstream answered, finish_reason=length -> NOT cached
    const first = await router.complete(baseRequest("m"));
    expect(first.meta.cached).toBe(false);
    expect(first.data.choices[0]?.finish_reason).toBe("length");
    expect(groq.callCount).toBe(1);

    // Second identical call -> should hit upstream again, not the cache
    const second = await router.complete(baseRequest("m"));
    expect(second.meta.cached).toBe(false);
    expect(second.meta.reason).not.toBe("cache");
    expect(groq.callCount).toBe(2);
  });

  it("DOES cache a finish_reason=stop response", async () => {
    const groq = new FakeProvider({
      id: "groq",
      models: ["m"],
      body: bodyWithFinish("stop"),
    });
    const router = new GatewayRouter(fakeRegistry([groq]));

    await router.complete(baseRequest("m"));
    const second = await router.complete(baseRequest("m"));

    expect(second.meta.cached).toBe(true);
    expect(second.meta.reason).toBe("cache");
    // Upstream was only called once even though the router was called twice.
    expect(groq.callCount).toBe(1);
  });

  it("surfaces finish_reason on the request log entry", async () => {
    const groq = new FakeProvider({
      id: "groq",
      models: ["m"],
      body: bodyWithFinish("length"),
    });
    const router = new GatewayRouter(fakeRegistry([groq]));

    await router.complete(baseRequest("m"));

    const recent = router.requestLog.getRecent(10);
    expect(recent[0]).toBeDefined();
    expect(recent[0]?.finishReason).toBe("length");
  });

  it("caches tool_calls finish_reason (it's a legitimate completion)", async () => {
    const groq = new FakeProvider({
      id: "groq",
      models: ["m"],
      body: bodyWithFinish("tool_calls"),
    });
    const router = new GatewayRouter(fakeRegistry([groq]));

    await router.complete(baseRequest("m"));
    const second = await router.complete(baseRequest("m"));
    expect(second.meta.cached).toBe(true);
  });
});

describe("GatewayRouter.complete (privacy=no-training)", () => {
  it("routes to a no-training provider and skips training ones", async () => {
    // gemini is tagged free-tier-trains in PROVIDER_PRIVACY; groq is no-training.
    const gemini = new FakeProvider({ id: "gemini", models: ["m"] });
    const groq = new FakeProvider({ id: "groq", models: ["m"] });
    const router = new GatewayRouter(fakeRegistry([gemini, groq]));

    const { meta } = await router.complete(baseRequest("m"), { privacy: "no-training" });
    expect(meta.provider).toBe("groq");
    // Gemini was never tried at all.
    expect(gemini.callCount).toBe(0);
    expect(groq.callCount).toBe(1);
  });

  it("rejects up front with model_not_supported when no eligible provider exists", async () => {
    // Only gemini is configured and it trains on free-tier requests.
    const gemini = new FakeProvider({ id: "gemini", models: ["m"] });
    const router = new GatewayRouter(fakeRegistry([gemini]));

    await expect(
      router.complete(baseRequest("m"), { privacy: "no-training" }),
    ).rejects.toMatchObject({ code: "model_not_supported" });
    // No provider was called.
    expect(gemini.callCount).toBe(0);
  });

  it("still works when privacy=any explicitly", async () => {
    const gemini = new FakeProvider({ id: "gemini", models: ["m"] });
    const router = new GatewayRouter(fakeRegistry([gemini]));

    const { meta } = await router.complete(baseRequest("m"), { privacy: "any" });
    expect(meta.provider).toBe("gemini");
  });
});

describe("GatewayRouter.complete (strict mode)", () => {
  it("rejects meta-models immediately", async () => {
    const groq = new FakeProvider({ id: "groq", models: ["groq/llama"] });
    const router = new GatewayRouter(fakeRegistry([groq]));
    await expect(router.complete(baseRequest("free"), { strict: true })).rejects.toBeInstanceOf(
      StrictModeError,
    );
    expect(groq.callCount).toBe(0);
  });

  it("does NOT failover after a 429 from the chosen provider", async () => {
    const groq = new FakeProvider({ id: "groq", models: ["m"], statuses: [429] });
    const gemini = new FakeProvider({ id: "gemini", models: ["m"] });
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    await expect(router.complete(baseRequest("m"), { strict: true })).rejects.toBeInstanceOf(
      ProviderClientError,
    );
    expect(groq.callCount).toBe(1);
    expect(gemini.callCount).toBe(0);
  });

  it("does NOT failover after a 500 from the chosen provider", async () => {
    const groq = new FakeProvider({ id: "groq", models: ["m"], statuses: [500] });
    const gemini = new FakeProvider({ id: "gemini", models: ["m"] });
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    await expect(router.complete(baseRequest("m"), { strict: true })).rejects.toBeInstanceOf(
      ProviderClientError,
    );
    expect(groq.callCount).toBe(1);
    expect(gemini.callCount).toBe(0);
  });

  it("succeeds when the chosen provider succeeds first try", async () => {
    const groq = new FakeProvider({ id: "groq", models: ["m"] });
    const router = new GatewayRouter(fakeRegistry([groq]));

    const { meta } = await router.complete(baseRequest("m"), { strict: true });
    expect(meta.provider).toBe("groq");
    expect(meta.reason).toBe("direct");
  });

  it("bypasses the cache (so a stale entry can't masquerade as fresh)", async () => {
    const groq = new FakeProvider({ id: "groq", models: ["m"] });
    const router = new GatewayRouter(fakeRegistry([groq]));
    // Prime the cache with a non-strict call.
    await router.complete(baseRequest("m"));
    expect(groq.callCount).toBe(1);
    // Strict call must hit the provider again, not the cache.
    await router.complete(baseRequest("m"), { strict: true });
    expect(groq.callCount).toBe(2);
  });
});

describe("GatewayRouter intra-provider model fallback", () => {
  it("falls back to the next Gemini Flash sibling after a 429", async () => {
    const gemini = new FakeProvider({
      id: "gemini",
      rateLimitScope: "model",
      models: [
        "gemini/gemini-flash-latest",
        "gemini/gemini-3.6-flash",
        "gemini/gemini-3.5-flash",
      ],
      statuses: [429, 200],
    });
    const router = new GatewayRouter(fakeRegistry([gemini]));

    const { meta } = await router.complete(baseRequest("gemini/gemini-flash-latest"));
    expect(gemini.callCount).toBe(2);
    expect(meta.resolvedModel).toBe("gemini/gemini-3.6-flash");
    expect(meta.reason).toBe("failover");
    expect(meta.provider).toBe("gemini");
  });

  it("falls back to the next Gemini Flash sibling after a 404", async () => {
    const gemini = new FakeProvider({
      id: "gemini",
      rateLimitScope: "model",
      models: [
        "gemini/gemini-flash-latest",
        "gemini/gemini-3.6-flash",
        "gemini/gemini-3.5-flash",
      ],
      statuses: [404, 200],
    });
    const router = new GatewayRouter(fakeRegistry([gemini]));

    const { meta } = await router.complete(baseRequest("gemini/gemini-flash-latest"));
    expect(gemini.callCount).toBe(2);
    expect(meta.resolvedModel).toBe("gemini/gemini-3.6-flash");
    expect(meta.reason).toBe("failover");
  });

  it("does not model-fallback for key-scoped providers", async () => {
    const keyScoped = new FakeProvider({
      id: "nim",
      rateLimitScope: "key",
      models: ["shared/a", "shared/b"],
      statuses: [429],
    });
    const other = new FakeProvider({
      id: "other",
      models: ["shared/a"],
    });
    const router = new GatewayRouter(fakeRegistry([keyScoped, other]));

    const { meta } = await router.complete(baseRequest("shared/a"));
    expect(keyScoped.callCount).toBe(1);
    expect(meta.provider).toBe("other");
  });
});
