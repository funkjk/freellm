/** Provider IDs ordered by speed (lowest latency first). */
export const FAST_PRIORITY = [
  "groq",
  "cloudflare",
  "gemini",
  "nim",
  "github",
  "mistral",
  "ollama",
] as const;

/** Provider IDs ordered by intelligence (most capable first). */
export const SMART_PRIORITY = [
  "gemini",
  "github",
  "nim",
  "groq",
  "cloudflare",
  "mistral",
  "ollama",
] as const;

/**
 * Provider IDs preferred for tool-calling workloads.
 * Ordered by capability; providers that do not support tools are omitted.
 */
export const TOOLS_PRIORITY = [
  "gemini",
  "github",
  "nim",
  "groq",
  "cloudflare",
  "mistral",
  "ollama",
] as const;

/** The set of meta-model names that trigger multi-provider routing. */
export const META_MODELS = new Set(["free", "free-fast", "free-smart", "free-tools"]);

/** Default concrete model to use per provider when a meta-model is requested. */
export const DEFAULT_MODELS: Record<string, string> = {
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-flash-latest",
  mistral: "mistral-small-latest",
  nim: "meta/llama-3.3-70b-instruct",
  cloudflare: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  github: "openai/gpt-4o-mini",
  ollama: "llama3",
};

/** 4xx codes that should NOT trigger failover (client/config errors). */
export const NON_RETRIABLE_STATUSES = new Set([400, 401, 403, 404]);

/**
 * Intra-provider model fallback chains for providers whose free-tier quotas
 * are enforced per model (not per API key). When the resolved model returns
 * 429/404, the router tries the next id in the same chain before excluding
 * the provider.
 *
 * Order is preference within the family (best/newest first). Chains wrap so
 * a mid-chain request can still fall back to siblings.
 *
 * Key-scoped providers (nim, ollama) are intentionally absent —
 * a 429 there means the whole key is hot, so model substitution would not help.
 */
export const MODEL_FALLBACK_CHAINS: readonly (readonly string[])[] = [
  [
    "gemini/gemini-flash-latest",
    "gemini/gemini-3.6-flash",
    "gemini/gemini-3.5-flash",
    "gemini/gemini-flash-lite-latest",
    "gemini/gemini-3.5-flash-lite",
  ],
  ["gemini/gemini-pro-latest"],
  [
    "groq/llama-3.3-70b-versatile",
    "groq/llama-3.1-8b-instant",
    "groq/meta-llama/llama-4-scout-17b-16e-instruct",
    "groq/qwen/qwen3-32b",
  ],
  [
    "mistral/mistral-small-latest",
    "mistral/open-mistral-nemo",
    "mistral/mistral-medium-latest",
  ],
  [
    "cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "cloudflare/@cf/meta/llama-3.1-8b-instruct",
    "cloudflare/@cf/meta/llama-3.2-3b-instruct",
    "cloudflare/@cf/mistral/mistral-small-3.1-24b-instruct",
    "cloudflare/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    "cloudflare/@cf/qwen/qwen2.5-coder-32b-instruct",
  ],
  [
    "github/openai/gpt-4o-mini",
    "github/openai/gpt-4.1-mini",
    "github/meta/Meta-Llama-3.3-70B-Instruct",
    "github/meta/Llama-3.2-11B-Vision-Instruct",
    "github/microsoft/Phi-4",
    "github/cohere/Command-R-plus-08-2024",
    "github/mistral-ai/Mistral-Large-2411",
  ],
];

/** Meta-model entries returned by GET /v1/models. */
export const META_MODEL_ENTRIES = [
  {
    id: "free",
    object: "model" as const,
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
  {
    id: "free-fast",
    object: "model" as const,
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
  {
    id: "free-smart",
    object: "model" as const,
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
  {
    id: "free-tools",
    object: "model" as const,
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
];
