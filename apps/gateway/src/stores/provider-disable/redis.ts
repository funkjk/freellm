import type { Redis } from "@upstash/redis";
import type { ProviderDisableStore } from "./types.js";

const KEY = "freellm:provider-disable";

export class RedisProviderDisableStore implements ProviderDisableStore {
  constructor(private redis: Redis) {}

  async isDisabled(providerId: string): Promise<boolean> {
    const n = await this.redis.sismember(KEY, providerId);
    return n === 1;
  }

  async setDisabled(providerId: string, disabled: boolean): Promise<void> {
    if (disabled) await this.redis.sadd(KEY, providerId);
    else await this.redis.srem(KEY, providerId);
  }

  async listDisabled(): Promise<string[]> {
    const members = (await this.redis.smembers(KEY)) ?? [];
    return members.sort();
  }
}
