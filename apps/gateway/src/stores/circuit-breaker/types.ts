import type { CircuitBreakerState } from "../../types.js";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
}

export interface CircuitBreakerStore {
  getState(): Promise<CircuitBreakerState>;
  isAllowed(): Promise<boolean>;
  onSuccess(): Promise<void>;
  onFailure(): Promise<void>;
  trip(): Promise<void>;
  reset(): Promise<void>;
}
