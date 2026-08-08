import type { Redis } from "@upstash/redis";
import type { CircuitBreakerState } from "../../types.js";
import { loadCircuitBreakerConfig } from "./memory.js";
import type { CircuitBreakerConfig, CircuitBreakerStore } from "./types.js";

const KEY_PREFIX = "freellm:cb:";

interface CbHash {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  nextAttemptAt: number | null;
}

export class RedisCircuitBreakerStore implements CircuitBreakerStore {
  private config: CircuitBreakerConfig;
  private key: string;

  constructor(
    private redis: Redis,
    providerId: string,
    config?: Partial<CircuitBreakerConfig>,
  ) {
    this.config = loadCircuitBreakerConfig(config);
    this.key = KEY_PREFIX + providerId;
  }

  private async load(): Promise<CbHash> {
    const raw = await this.redis.hgetall<Record<string, string>>(this.key);
    if (!raw || Object.keys(raw).length === 0) {
      return { state: "closed", failureCount: 0, successCount: 0, nextAttemptAt: null };
    }
    return {
      state: (raw.state as CircuitBreakerState) || "closed",
      failureCount: Number(raw.failureCount ?? 0),
      successCount: Number(raw.successCount ?? 0),
      nextAttemptAt: raw.nextAttemptAt ? Number(raw.nextAttemptAt) : null,
    };
  }

  private async save(data: CbHash): Promise<void> {
    await this.redis.hset(this.key, {
      state: data.state,
      failureCount: String(data.failureCount),
      successCount: String(data.successCount),
      nextAttemptAt: data.nextAttemptAt != null ? String(data.nextAttemptAt) : "",
    });
    await this.redis.pexpire(this.key, Math.max(this.config.timeout * 4, 120_000));
  }

  async getState(): Promise<CircuitBreakerState> {
    const data = await this.load();
    if (data.state === "open") {
      if (Date.now() >= (data.nextAttemptAt ?? 0)) {
        data.state = "half_open";
        data.successCount = 0;
        await this.save(data);
      }
    }
    return data.state;
  }

  async isAllowed(): Promise<boolean> {
    return (await this.getState()) !== "open";
  }

  async onSuccess(): Promise<void> {
    const data = await this.load();
    let state = data.state;
    if (state === "open" && Date.now() >= (data.nextAttemptAt ?? 0)) {
      state = "half_open";
      data.successCount = 0;
    }
    if (state === "half_open") {
      data.successCount++;
      data.state = "half_open";
      if (data.successCount >= this.config.successThreshold) {
        await this.reset();
        return;
      }
      await this.save(data);
    } else if (state === "closed") {
      data.failureCount = 0;
      data.state = "closed";
      await this.save(data);
    }
  }

  async onFailure(): Promise<void> {
    const data = await this.load();
    let state = data.state;
    if (state === "open" && Date.now() >= (data.nextAttemptAt ?? 0)) {
      state = "half_open";
      data.successCount = 0;
    }
    if (state === "half_open") {
      await this.trip();
    } else if (state === "closed") {
      data.failureCount++;
      data.state = "closed";
      if (data.failureCount >= this.config.failureThreshold) {
        await this.trip();
        return;
      }
      await this.save(data);
    }
  }

  async trip(): Promise<void> {
    await this.save({
      state: "open",
      failureCount: 0,
      successCount: 0,
      nextAttemptAt: Date.now() + this.config.timeout,
    });
  }

  async reset(): Promise<void> {
    await this.save({
      state: "closed",
      failureCount: 0,
      successCount: 0,
      nextAttemptAt: null,
    });
  }
}
