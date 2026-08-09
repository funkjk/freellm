import type { Redis } from "@upstash/redis";
import type { RoutingStrategy } from "../../types.js";
import type { RoutingConfigStore } from "./types.js";

const KEY = "freellm:routing:strategy";

function parseStrategy(raw: unknown): RoutingStrategy {
  return raw === "random" ? "random" : "round_robin";
}

export class RedisRoutingConfigStore implements RoutingConfigStore {
  constructor(private redis: Redis) {}

  async getStrategy(): Promise<RoutingStrategy> {
    const raw = await this.redis.get<string>(KEY);
    return parseStrategy(raw);
  }

  async setStrategy(strategy: RoutingStrategy): Promise<void> {
    await this.redis.set(KEY, strategy);
  }
}
