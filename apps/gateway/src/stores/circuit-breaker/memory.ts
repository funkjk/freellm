import type { CircuitBreakerState } from "../../types.js";
import type { CircuitBreakerConfig, CircuitBreakerStore } from "./types.js";

export function loadCircuitBreakerConfig(
  overrides?: Partial<CircuitBreakerConfig>,
): CircuitBreakerConfig {
  const failureThreshold = Number.parseInt(process.env.CB_FAILURE_THRESHOLD ?? "3", 10);
  const successThreshold = Number.parseInt(process.env.CB_SUCCESS_THRESHOLD ?? "2", 10);
  const timeout = Number.parseInt(process.env.CB_TIMEOUT_MS ?? "30000", 10);
  const env: CircuitBreakerConfig = {
    failureThreshold: Number.isNaN(failureThreshold) ? 3 : failureThreshold,
    successThreshold: Number.isNaN(successThreshold) ? 2 : successThreshold,
    timeout: Number.isNaN(timeout) ? 30_000 : timeout,
  };
  return { ...env, ...overrides };
}

export class MemoryCircuitBreakerStore implements CircuitBreakerStore {
  private state: CircuitBreakerState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptAt: number | null = null;
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = loadCircuitBreakerConfig(config);
  }

  async getState(): Promise<CircuitBreakerState> {
    if (this.state === "open") {
      if (Date.now() >= (this.nextAttemptAt ?? 0)) {
        this.state = "half_open";
        this.successCount = 0;
      }
    }
    return this.state;
  }

  async isAllowed(): Promise<boolean> {
    return (await this.getState()) !== "open";
  }

  async onSuccess(): Promise<void> {
    const state = await this.getState();
    if (state === "half_open") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        await this.reset();
      }
    } else if (state === "closed") {
      this.failureCount = 0;
    }
  }

  async onFailure(): Promise<void> {
    const state = await this.getState();
    if (state === "half_open") {
      await this.trip();
    } else if (state === "closed") {
      this.failureCount++;
      if (this.failureCount >= this.config.failureThreshold) {
        await this.trip();
      }
    }
  }

  async trip(): Promise<void> {
    this.state = "open";
    this.nextAttemptAt = Date.now() + this.config.timeout;
    this.failureCount = 0;
    this.successCount = 0;
  }

  async reset(): Promise<void> {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptAt = null;
  }
}
