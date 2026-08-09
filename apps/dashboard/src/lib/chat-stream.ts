/**
 * Streaming + non-streaming chat helpers for the dashboard playground.
 * Uses the OpenAI-compatible SSE shape returned by POST /api/v1/chat/completions.
 */

import { getAuthHeaders } from "@/lib/api-key";

export interface ChatStreamMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRouteMeta {
  provider?: string;
  model?: string;
  requestedModel?: string;
  cached?: boolean;
  routeReason?: string;
}

export interface StreamChatOptions {
  model: string;
  messages: ChatStreamMessage[];
  temperature?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  /** Fired as soon as routing metadata is known (headers or freellm.route event). */
  onMeta?: (meta: ChatRouteMeta) => void;
}

function metaFromHeaders(headers: Headers): ChatRouteMeta {
  // Fetch normalizes names; try both common casings for robustness.
  const get = (name: string) =>
    headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;

  return {
    provider: get("X-FreeLLM-Provider") ?? undefined,
    model: get("X-FreeLLM-Model") ?? undefined,
    requestedModel: get("X-FreeLLM-Requested-Model") ?? undefined,
    cached: get("X-FreeLLM-Cached") === "true",
    routeReason: get("X-FreeLLM-Route-Reason") ?? undefined,
  };
}

function mergeMeta(base: ChatRouteMeta, next: ChatRouteMeta): ChatRouteMeta {
  return {
    provider: next.provider ?? base.provider,
    model: next.model ?? base.model,
    requestedModel: next.requestedModel ?? base.requestedModel,
    cached: next.cached ?? base.cached,
    routeReason: next.routeReason ?? base.routeReason,
  };
}

function hasRouteInfo(meta: ChatRouteMeta): boolean {
  return Boolean(meta.provider || meta.model);
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    return body.error?.message ?? response.statusText;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

/**
 * Stream a chat completion. Resolves with route metadata once the stream ends.
 */
export async function streamChatCompletion(options: StreamChatOptions): Promise<ChatRouteMeta> {
  const response = await fetch("/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  let meta = metaFromHeaders(response.headers);
  if (hasRouteInfo(meta)) {
    options.onMeta?.(meta);
  }

  const body = response.body;
  if (!body) {
    throw new Error("Streaming response had no body");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events end with a blank line
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of block.split("\n")) {
        const trimmed = line.replace(/\r$/, "");
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trimStart();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as {
            object?: string;
            provider?: string;
            model?: string;
            requested_model?: string;
            reason?: string;
            cached?: boolean;
            choices?: Array<{ delta?: { content?: string | null } }>;
          };

          if (json.object === "freellm.route") {
            meta = mergeMeta(meta, {
              provider: json.provider,
              model: json.model,
              requestedModel: json.requested_model,
              cached: json.cached,
              routeReason: json.reason,
            });
            options.onMeta?.(meta);
            continue;
          }

          // Fallback: OpenAI chunks often include the resolved model id.
          if (typeof json.model === "string" && json.model && !meta.model) {
            meta = mergeMeta(meta, { model: json.model });
            options.onMeta?.(meta);
          }

          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            options.onDelta(delta);
          }
        } catch {
          // Ignore malformed chunks; upstream may forward non-JSON keepalives.
        }
      }
    }
  }

  return meta;
}
