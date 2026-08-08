/**
 * Virtual sub-keys with soft rolling-24h caps.
 *
 * Key definitions load from file or FREELLM_VIRTUAL_KEYS_JSON.
 * Counters live in a VirtualKeyCounterStore (memory or Redis).
 */

import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { logger } from "../logger.js";
import { getStores } from "../stores/create-stores.js";
import type { VirtualKeyCounterStore } from "../stores/virtual-keys/types.js";
import { MemoryVirtualKeyCounterStore } from "../stores/virtual-keys/memory.js";

const KEY_ID_PATTERN = /^sk-freellm-[A-Za-z0-9_-]{4,128}$/;
const MAX_FILE_BYTES = 1_048_576; // 1 MB
const WINDOW_MS = 24 * 60 * 60 * 1_000; // rolling 24h

const virtualKeySchema = z.object({
  id: z.string().regex(KEY_ID_PATTERN),
  label: z.string().min(1).max(128),
  dailyRequestCap: z.number().int().positive().optional(),
  dailyTokenCap: z.number().int().positive().optional(),
  allowedModels: z.array(z.string().min(1)).optional(),
  expiresAt: z.string().datetime().optional(),
});

const virtualKeysFileSchema = z.object({
  keys: z.array(virtualKeySchema),
});

export type VirtualKey = z.infer<typeof virtualKeySchema>;

export interface VirtualKeyUsage {
  requestsInWindow: number;
  tokensInWindow: number;
  requestCapRemaining: number | null;
  tokenCapRemaining: number | null;
}

export class VirtualKeysError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VirtualKeysError";
  }
}

export class VirtualKeyCheckError extends Error {
  constructor(
    public readonly reason:
      | "expired"
      | "model_not_allowed"
      | "request_cap_reached"
      | "token_cap_reached",
    message: string,
  ) {
    super(message);
    this.name = "VirtualKeyCheckError";
  }
}

function pruneCounter(
  requestTimes: number[],
  tokenEvents: Array<{ at: number; tokens: number }>,
  now: number,
) {
  const windowStart = now - WINDOW_MS;
  return {
    requestTimes: requestTimes.filter((t) => t > windowStart),
    tokenEvents: tokenEvents.filter((e) => e.at > windowStart),
  };
}

/**
 * Hold the parsed key definitions and delegate counters to a store.
 */
export class VirtualKeyStore {
  private keysById = new Map<string, VirtualKey>();
  private counters: VirtualKeyCounterStore;

  constructor(keys: VirtualKey[], counters?: VirtualKeyCounterStore) {
    this.counters = counters ?? new MemoryVirtualKeyCounterStore();
    for (const key of keys) {
      if (this.keysById.has(key.id)) {
        throw new VirtualKeysError(`duplicate virtual key id: ${key.id}`);
      }
      this.keysById.set(key.id, key);
    }
  }

  size(): number {
    return this.keysById.size;
  }

  list(): VirtualKey[] {
    return [...this.keysById.values()];
  }

  findByToken(token: string): VirtualKey | undefined {
    return this.keysById.get(token);
  }

  async assertCanServe(key: VirtualKey, model: string, now: number = Date.now()): Promise<void> {
    if (key.expiresAt) {
      const expiresMs = Date.parse(key.expiresAt);
      if (Number.isFinite(expiresMs) && now > expiresMs) {
        throw new VirtualKeyCheckError("expired", `virtual key ${key.id} is expired`);
      }
    }

    if (key.allowedModels && key.allowedModels.length > 0) {
      if (!key.allowedModels.includes(model)) {
        throw new VirtualKeyCheckError(
          "model_not_allowed",
          `virtual key ${key.id} does not allow model "${model}"`,
        );
      }
    }

    const fresh = await this.counters.get(key.id);
    const pruned = pruneCounter(fresh.requestTimes, fresh.tokenEvents, now);

    if (key.dailyRequestCap != null && pruned.requestTimes.length >= key.dailyRequestCap) {
      throw new VirtualKeyCheckError(
        "request_cap_reached",
        `virtual key ${key.id} exhausted its 24h request cap (${key.dailyRequestCap})`,
      );
    }

    if (key.dailyTokenCap != null) {
      const usedTokens = pruned.tokenEvents.reduce((a, e) => a + e.tokens, 0);
      if (usedTokens >= key.dailyTokenCap) {
        throw new VirtualKeyCheckError(
          "token_cap_reached",
          `virtual key ${key.id} exhausted its 24h token cap (${key.dailyTokenCap})`,
        );
      }
    }
  }

  async recordRequest(key: VirtualKey, tokens: number, now: number = Date.now()): Promise<void> {
    if (!this.keysById.has(key.id)) return;
    const fresh = await this.counters.get(key.id);
    const pruned = pruneCounter(fresh.requestTimes, fresh.tokenEvents, now);
    pruned.requestTimes.push(now);
    if (tokens > 0) pruned.tokenEvents.push({ at: now, tokens });
    await this.counters.set(key.id, pruned);
  }

  async usage(keyId: string, now: number = Date.now()): Promise<VirtualKeyUsage | undefined> {
    const key = this.keysById.get(keyId);
    if (!key) return undefined;
    const fresh = await this.counters.get(keyId);
    const pruned = pruneCounter(fresh.requestTimes, fresh.tokenEvents, now);
    const tokens = pruned.tokenEvents.reduce((a, e) => a + e.tokens, 0);
    return {
      requestsInWindow: pruned.requestTimes.length,
      tokensInWindow: tokens,
      requestCapRemaining:
        key.dailyRequestCap != null
          ? Math.max(0, key.dailyRequestCap - pruned.requestTimes.length)
          : null,
      tokenCapRemaining: key.dailyTokenCap != null ? Math.max(0, key.dailyTokenCap - tokens) : null,
    };
  }
}

function parseVirtualKeysPayload(parsed: unknown, source: string): VirtualKeyStore {
  const result = virtualKeysFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    throw new VirtualKeysError(`virtual keys ${source} schema error: ${issues}`);
  }
  return new VirtualKeyStore(result.data.keys, getStores().vkCounters);
}

export function loadVirtualKeysFromFile(path: string): VirtualKeyStore {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (err) {
    throw new VirtualKeysError(
      `cannot stat virtual keys file at ${path}: ${(err as Error).message}`,
    );
  }

  if (stat.size > MAX_FILE_BYTES) {
    throw new VirtualKeysError(
      `virtual keys file ${path} is ${stat.size} bytes, limit is ${MAX_FILE_BYTES}`,
    );
  }

  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new VirtualKeysError(
      `virtual keys file ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }

  return parseVirtualKeysPayload(parsed, `file ${path}`);
}

/** Load virtual keys from a JSON string (e.g. FREELLM_VIRTUAL_KEYS_JSON). */
export function loadVirtualKeysFromJson(raw: string): VirtualKeyStore {
  if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES) {
    throw new VirtualKeysError(
      `FREELLM_VIRTUAL_KEYS_JSON is larger than ${MAX_FILE_BYTES} bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new VirtualKeysError(
      `FREELLM_VIRTUAL_KEYS_JSON is not valid JSON: ${(err as Error).message}`,
    );
  }
  return parseVirtualKeysPayload(parsed, "FREELLM_VIRTUAL_KEYS_JSON");
}

export function emptyVirtualKeyStore(): VirtualKeyStore {
  return new VirtualKeyStore([], getStores().vkCounters);
}

/**
 * Load from FREELLM_VIRTUAL_KEYS_JSON (preferred for serverless) or
 * FREELLM_VIRTUAL_KEYS_PATH. JSON env wins when both are set.
 */
export function loadVirtualKeysFromEnv(): VirtualKeyStore {
  const json = process.env.FREELLM_VIRTUAL_KEYS_JSON;
  if (json && json.trim()) {
    const store = loadVirtualKeysFromJson(json);
    logger.info(
      { keyCount: store.size(), source: "FREELLM_VIRTUAL_KEYS_JSON" },
      "virtual keys loaded (SOFT CAPS -- counters use configured state backend)",
    );
    return store;
  }

  const path = process.env.FREELLM_VIRTUAL_KEYS_PATH;
  if (!path) return emptyVirtualKeyStore();
  const store = loadVirtualKeysFromFile(path);
  logger.info(
    { path, keyCount: store.size() },
    "virtual keys loaded (SOFT CAPS -- counters use configured state backend)",
  );
  return store;
}

let _store: VirtualKeyStore = new VirtualKeyStore([]);
let _initialized = false;

export function initVirtualKeys(): VirtualKeyStore {
  if (_initialized) return _store;
  _store = loadVirtualKeysFromEnv();
  _initialized = true;
  return _store;
}

export function setVirtualKeyStore(next: VirtualKeyStore): void {
  _store = next;
  _initialized = true;
}

export function getVirtualKeyStore(): VirtualKeyStore {
  return _store;
}
