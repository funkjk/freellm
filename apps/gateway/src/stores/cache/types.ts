import type { ChatCompletionResponse } from "../../types.js";

export interface CacheEntry {
  response: ChatCompletionResponse;
  provider: string;
  expiresAt: number;
  createdAt: number;
  hitCount: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Low-level cache persistence. ResponseCache owns keying + policy.
 */
export interface CacheBackend {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
  /** Optional: bump LRU order on hit. Memory implements; Redis may no-op. */
  touch?(key: string, entry: CacheEntry): Promise<void>;
}
