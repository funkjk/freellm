import type { Redis } from "@upstash/redis";
import type { VirtualKeyCounterSnapshot, VirtualKeyCounterStore } from "./types.js";

const WINDOW_MS = 24 * 60 * 60 * 1_000;
const KEY_PREFIX = "freellm:vk:ctr:";

function prune(snapshot: VirtualKeyCounterSnapshot, now: number): VirtualKeyCounterSnapshot {
  const windowStart = now - WINDOW_MS;
  return {
    requestTimes: snapshot.requestTimes.filter((t) => t > windowStart),
    tokenEvents: snapshot.tokenEvents.filter((e) => e.at > windowStart),
  };
}

export class RedisVirtualKeyCounterStore implements VirtualKeyCounterStore {
  constructor(private redis: Redis) {}

  async get(keyId: string): Promise<VirtualKeyCounterSnapshot> {
    const raw = await this.redis.get<VirtualKeyCounterSnapshot>(KEY_PREFIX + keyId);
    if (!raw) return { requestTimes: [], tokenEvents: [] };
    return prune(raw, Date.now());
  }

  async set(keyId: string, snapshot: VirtualKeyCounterSnapshot): Promise<void> {
    const pruned = prune(snapshot, Date.now());
    await this.redis.set(KEY_PREFIX + keyId, pruned, { px: WINDOW_MS });
  }
}
