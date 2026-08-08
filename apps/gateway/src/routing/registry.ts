import { FAST_PRIORITY, SMART_PRIORITY } from "../config.js";
import { CerebrasProvider } from "../providers/cerebras.js";
import { CloudflareProvider } from "../providers/cloudflare.js";
import { GeminiProvider } from "../providers/gemini.js";
import { GitHubModelsProvider } from "../providers/github.js";
import { GroqProvider } from "../providers/groq.js";
import { MistralProvider } from "../providers/mistral.js";
import { NimProvider } from "../providers/nim.js";
import { OllamaProvider } from "../providers/ollama.js";
import type { ProviderAdapter } from "../providers/types.js";
import type {
  ModelObject,
  ProviderStatusInfo,
  RoutingStrategy,
  TokenUsageTotals,
} from "../types.js";
import { PROVIDER_PRIVACY } from "./privacy.js";

const EMPTY_USAGE: TokenUsageTotals = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
};

export class ProviderRegistry {
  private providers: ProviderAdapter[];

  constructor() {
    this.providers = [
      new GroqProvider(),
      new GeminiProvider(),
      new MistralProvider(),
      new CerebrasProvider(),
      new NimProvider(),
      new CloudflareProvider(),
      new GitHubModelsProvider(),
      new OllamaProvider(),
    ];
  }

  getAll(): ProviderAdapter[] {
    return this.providers;
  }

  getEnabled(): ProviderAdapter[] {
    return this.providers.filter((p) => p.isEnabled());
  }

  async getAvailable(): Promise<ProviderAdapter[]> {
    const out: ProviderAdapter[] = [];
    for (const p of this.providers) {
      if (await p.isAvailable()) out.push(p);
    }
    return out;
  }

  getById(id: string): ProviderAdapter | undefined {
    return this.providers.find((p) => p.id === id);
  }

  getAllModels(): ModelObject[] {
    return this.providers.filter((p) => p.isEnabled()).flatMap((p) => p.models);
  }

  async getProviderForMetaModel(
    metaModel: string,
    excluded: Set<string>,
    strategy: RoutingStrategy = "round_robin",
    rrIndex = 0,
    advanceRrIndex?: (next: number) => void,
  ): Promise<ProviderAdapter | undefined> {
    const available = (await this.getAvailable()).filter((p) => !excluded.has(p.id));
    if (available.length === 0) return undefined;

    let candidates: ProviderAdapter[];
    if (metaModel === "free-fast") {
      candidates = [...FAST_PRIORITY]
        .map((id) => available.find((a) => a.id === id))
        .filter((p): p is ProviderAdapter => p !== undefined);
    } else if (metaModel === "free-smart") {
      candidates = [...SMART_PRIORITY]
        .map((id) => available.find((a) => a.id === id))
        .filter((p): p is ProviderAdapter => p !== undefined);
    } else {
      candidates = available;
    }

    if (candidates.length === 0) return undefined;

    if (strategy === "random") {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    const idx = rrIndex % candidates.length;
    if (advanceRrIndex) advanceRrIndex(rrIndex + 1);
    return candidates[idx];
  }

  async getStatusAll(
    usageByProvider: Record<string, TokenUsageTotals> = {},
  ): Promise<ProviderStatusInfo[]> {
    const result: ProviderStatusInfo[] = [];
    for (const p of this.providers) {
      const stats = p.getStats();
      const keys = await p.getKeysStatus();
      const privacyEntry = PROVIDER_PRIVACY[p.id];
      result.push({
        id: p.id,
        name: p.name,
        enabled: p.isEnabled(),
        circuitBreakerState: await p.getCircuitBreakerState(),
        totalRequests: stats.totalRequests,
        successRequests: stats.successRequests,
        failedRequests: stats.failedRequests,
        rateLimitedRequests: stats.rateLimitedRequests,
        lastError: stats.lastError ?? null,
        lastUsedAt: stats.lastUsedAt ?? null,
        models: p.models.map((m) => m.id),
        keyCount: keys.length,
        keysAvailable: keys.filter((k) => !k.rateLimited).length,
        keys,
        usage: usageByProvider[p.id] ?? EMPTY_USAGE,
        privacy: privacyEntry
          ? {
              policy: privacyEntry.policy,
              sourceUrl: privacyEntry.source_url,
              lastVerified: privacyEntry.last_verified,
            }
          : undefined,
      });
    }
    return result;
  }
}
