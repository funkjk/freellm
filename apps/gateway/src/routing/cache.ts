/**
 * In-memory LRU response cache for OpenAI-compatible chat completions.
 * Persistence is delegated to a CacheBackend (memory or Redis).
 */

import { createHash } from "node:crypto";
import type { CacheBackend, CacheEntry } from "../stores/cache/types.js";
import { MemoryCacheBackend } from "../stores/cache/memory.js";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../types.js";

export function hasImageContent(request: ChatCompletionRequest): boolean {
  return request.messages.some(
    (msg) =>
      Array.isArray(msg.content) &&
      msg.content.some(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          (part as Record<string, unknown>).type === "image_url",
      ),
  );
}

export interface CacheStats {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  currentSize: number;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  hitRate: number;
}

export class ResponseCache {
  private backend: CacheBackend;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly enabled: boolean;

  private hits = 0;
  private misses = 0;
  private sets = 0;
  private evictions = 0;

  constructor(backend?: CacheBackend) {
    this.backend = backend ?? new MemoryCacheBackend();
    this.enabled = (process.env.CACHE_ENABLED ?? "true").toLowerCase() !== "false";
    this.ttlMs = Number.parseInt(process.env.CACHE_TTL_MS ?? "3600000", 10);
    this.maxEntries = Number.parseInt(process.env.CACHE_MAX_ENTRIES ?? "1000", 10);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private buildKey(request: ChatCompletionRequest): string {
    const normalized = JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? null,
      max_tokens: request.max_tokens ?? null,
      max_completion_tokens: request.max_completion_tokens ?? null,
      top_p: request.top_p ?? null,
      stop: request.stop ?? null,
      presence_penalty: request.presence_penalty ?? null,
      frequency_penalty: request.frequency_penalty ?? null,
      seed: request.seed ?? null,
      tools: request.tools ?? null,
      tool_choice: request.tool_choice ?? null,
      parallel_tool_calls: request.parallel_tool_calls ?? null,
      response_format: request.response_format ?? null,
      reasoning_effort: request.reasoning_effort ?? null,
    });
    return createHash("sha256").update(normalized).digest("hex");
  }

  async get(request: ChatCompletionRequest): Promise<
    | {
        response: ChatCompletionResponse;
        provider: string;
        promptTokens: number;
        completionTokens: number;
      }
    | undefined
  > {
    if (!this.enabled) return undefined;
    if (request.stream) return undefined;
    if (hasImageContent(request)) return undefined;
    if (request.response_format?.type === "json_schema") return undefined;

    const key = this.buildKey(request);
    const entry = await this.backend.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      await this.backend.delete(key);
      this.misses++;
      return undefined;
    }

    entry.hitCount++;
    if (this.backend.touch) {
      await this.backend.touch(key, entry);
    } else {
      await this.backend.set(key, entry, Math.max(1, entry.expiresAt - Date.now()));
    }

    this.hits++;

    return {
      response: entry.response,
      provider: entry.provider,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
    };
  }

  async set(
    request: ChatCompletionRequest,
    response: ChatCompletionResponse,
    provider: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<void> {
    if (!this.enabled) return;
    if (request.stream) return;
    if (hasImageContent(request)) return;
    if (request.response_format?.type === "json_schema") return;
    if (!ResponseCache.isCacheable(response)) return;

    const key = this.buildKey(request);
    const size = await this.backend.size();
    const existing = await this.backend.get(key);
    if (!existing && size >= this.maxEntries) {
      this.evictions++;
    }

    const entry: CacheEntry = {
      response,
      provider,
      promptTokens,
      completionTokens,
      expiresAt: Date.now() + this.ttlMs,
      createdAt: Date.now(),
      hitCount: 0,
    };
    await this.backend.set(key, entry, this.ttlMs);
    this.sets++;
  }

  async clear(): Promise<void> {
    await this.backend.clear();
  }

  static isCacheable(response: ChatCompletionResponse): boolean {
    if (!response.choices || response.choices.length === 0) return false;
    for (const choice of response.choices) {
      if (choice.finish_reason === "length") return false;
    }
    return true;
  }

  async getStats(): Promise<CacheStats> {
    const total = this.hits + this.misses;
    return {
      enabled: this.enabled,
      ttlMs: this.ttlMs,
      maxEntries: this.maxEntries,
      currentSize: await this.backend.size(),
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}
