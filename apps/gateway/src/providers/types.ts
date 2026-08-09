import type {
  ChatCompletionRequest,
  CircuitBreakerState,
  KeyStatus,
  ModelObject,
  ProviderStats,
} from "../types.js";

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly models: ModelObject[];
  readonly supportsStreamUsage: boolean;
  /** Whether this provider accepts the `tools` / `tool_choice` fields.
   *  Providers that don't support tool calling return 400 when tools are present. */
  readonly supportsTools: boolean;

  isEnabled(): boolean;
  /** Operator-disabled via Dashboard/admin API (keys may still be configured). */
  isManuallyDisabled(): Promise<boolean>;
  getStats(): ProviderStats;
  getCircuitBreakerState(): Promise<CircuitBreakerState>;
  isAvailable(): Promise<boolean>;
  getKeysStatus(): Promise<KeyStatus[]>;

  complete(request: ChatCompletionRequest): Promise<Response>;
  onSuccess(response: Response): Promise<void>;
  onRateLimit(response: Response, retryAfterSeconds?: number): Promise<void>;
  onError(): Promise<void>;
  resetCircuitBreaker(): Promise<void>;
}
