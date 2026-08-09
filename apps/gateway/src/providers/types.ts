import type {
  ChatCompletionRequest,
  CircuitBreakerState,
  KeyStatus,
  ModelObject,
  ModelRateStatus,
  ProviderStats,
} from "../types.js";

/** How upstream free-tier quotas are enforced for this provider. */
export type RateLimitScope = "key" | "model";

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly models: ModelObject[];
  readonly supportsStreamUsage: boolean;
  /** Whether this provider accepts the `tools` / `tool_choice` fields.
   *  Providers that don't support tool calling return 400 when tools are present. */
  readonly supportsTools: boolean;
  /**
   * `model` — upstream quotas are per model (Gemini/Groq/Mistral/…). A 429 on
   * one model should not block siblings; the router may fall back inside the
   * provider. `key` — a 429 means the whole key is hot (NIM/Ollama).
   */
  readonly rateLimitScope: RateLimitScope;

  isEnabled(): boolean;
  /** Operator-disabled via Dashboard/admin API (keys may still be configured). */
  isManuallyDisabled(): Promise<boolean>;
  getStats(): ProviderStats;
  getCircuitBreakerState(): Promise<CircuitBreakerState>;
  isAvailable(): Promise<boolean>;
  /** When `rateLimitScope` is `model`, check capacity for one FreeLLM model id. */
  isAvailableForModel(modelId: string): Promise<boolean>;
  getKeysStatus(): Promise<KeyStatus[]>;
  /** Per-model cooldown rows for Dashboard; empty when scope is `key`. */
  getModelsStatus(): Promise<ModelRateStatus[]>;

  complete(request: ChatCompletionRequest): Promise<Response>;
  onSuccess(response: Response): Promise<void>;
  onRateLimit(response: Response, retryAfterSeconds?: number): Promise<void>;
  onError(): Promise<void>;
  resetCircuitBreaker(): Promise<void>;
}
