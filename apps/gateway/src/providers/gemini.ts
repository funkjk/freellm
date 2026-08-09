import type { ChatCompletionRequest, ModelObject } from "../types.js";
import { BaseProvider, parseApiKeys } from "./base.js";

/**
 * Gemini OpenAI-compatibility adapter.
 *
 * Non-obvious translations because Google's OpenAI-compat endpoint does not
 * quite match the OpenAI Chat Completions contract:
 *
 * 1. **reasoning_effort.** Pro models need a non-zero thinking budget, so we
 *    default unset requests to `"low"`. Flash models: do NOT send a default.
 *    Google now rejects `"none"` with HTTP 400 INVALID_ARGUMENT
 *    ("Request contains an invalid argument."). Omitting the field matches
 *    the working OpenAI-compat path. Explicit `"none"` from callers is
 *    stripped on the way out for the same reason.
 *
 * 2. **Exactly one of `max_tokens` / `max_completion_tokens`.** Gemini's
 *    OpenAI-compat endpoint returns a 400 when both are present. Prefer
 *    `max_completion_tokens` and drop `max_tokens`.
 *
 * 3. **Catalog prefers floating `-latest` aliases**, then pinned Gemini 3.x
 *    Flash ids. The 2.5 family is removed (404 for many keys / approaching
 *    shutdown). Quotas are per model, so `rateLimitScope` is `"model"` and
 *    the router falls back across the Flash chain on 429/404.
 */
export class GeminiProvider extends BaseProvider {
  readonly id = "gemini";
  readonly name = "Gemini";
  override readonly supportsStreamUsage = true;
  override readonly rateLimitScope = "model" as const;

  get baseUrl(): string {
    return process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";
  }

  readonly models: ModelObject[] = [
    {
      id: "gemini/gemini-flash-latest",
      object: "model",
      created: 1700000000,
      owned_by: "google",
      provider: "gemini",
      supportsVision: true,
    },
    {
      id: "gemini/gemini-3.6-flash",
      object: "model",
      created: 1700000000,
      owned_by: "google",
      provider: "gemini",
      supportsVision: true,
    },
    {
      id: "gemini/gemini-3.5-flash",
      object: "model",
      created: 1700000000,
      owned_by: "google",
      provider: "gemini",
      supportsVision: true,
    },
    {
      id: "gemini/gemini-flash-lite-latest",
      object: "model",
      created: 1700000000,
      owned_by: "google",
      provider: "gemini",
      supportsVision: true,
    },
    {
      id: "gemini/gemini-3.5-flash-lite",
      object: "model",
      created: 1700000000,
      owned_by: "google",
      provider: "gemini",
      supportsVision: true,
    },
    {
      id: "gemini/gemini-pro-latest",
      object: "model",
      created: 1700000000,
      owned_by: "google",
      provider: "gemini",
      supportsVision: true,
    },
  ];

  protected getApiKeys(): string[] {
    return parseApiKeys(process.env.GEMINI_API_KEY);
  }

  protected override mapRequest(request: ChatCompletionRequest): ChatCompletionRequest {
    const mapped = super.mapRequest(request);

    // Per-model reasoning_effort default. The base mapRequest already
    // stripped the "gemini/" prefix so `mapped.model` is the raw model id.
    if (mapped.reasoning_effort === undefined) {
      const effort = defaultReasoningEffortFor(mapped.model);
      if (effort !== undefined) {
        mapped.reasoning_effort = effort;
      }
    }

    // Google rejects reasoning_effort: "none" with 400 INVALID_ARGUMENT.
    // Drop it so Flash (and mistaken Pro "none") still reach the model.
    if (mapped.reasoning_effort === "none") {
      (mapped as { reasoning_effort?: ChatCompletionRequest["reasoning_effort"] }).reasoning_effort =
        undefined;
    }

    // Normalize the output budget to max_completion_tokens only.
    if (mapped.max_completion_tokens == null && mapped.max_tokens != null) {
      mapped.max_completion_tokens = mapped.max_tokens;
    }
    if (mapped.max_tokens != null) {
      (mapped as { max_tokens?: number | null }).max_tokens = undefined;
    }

    return mapped;
  }
}

/**
 * Exported for tests. Returns the default reasoning effort Gemini should
 * receive when the caller did not set one, or `undefined` to omit the field.
 */
export function defaultReasoningEffortFor(
  modelId: string,
): "low" | "medium" | "high" | undefined {
  // Pro requires a non-zero thinking budget; "low" is the minimum accepted.
  if (modelId.includes("pro")) return "low";
  // Flash: omit the field. Sending "none" is rejected by Google as of 2026-08.
  if (modelId.includes("flash")) return undefined;
  // Unknown reasoning models: "low" is the conservative accepted default.
  return "low";
}
