import { getListModelsQueryKey, useListModels } from "@/api/hooks";
import { ApiKeyGate } from "@/components/api-key-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isAuthError } from "@/lib/api-key";
import {
  type ChatRouteMeta,
  type ChatStreamMessage,
  streamChatCompletion,
} from "@/lib/chat-stream";
import { cn } from "@/lib/utils";
import {
  Bot,
  Loader2,
  MessageSquare,
  RotateCcw,
  Send,
  Square,
  User,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSearch } from "wouter";

const META_MODELS = [
  {
    id: "free",
    label: "free",
    desc: "Max uptime — round-robin across providers",
  },
  {
    id: "free-fast",
    label: "free-fast",
    desc: "Lowest latency first",
  },
  {
    id: "free-smart",
    label: "free-smart",
    desc: "Most capable first",
  },
  {
    id: "free-tools",
    label: "free-tools",
    desc: "Tool-calling capable providers only",
  },
] as const;

type MetaModelId = (typeof META_MODELS)[number]["id"];

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: ChatRouteMeta;
  error?: boolean;
}

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseInitialModel(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const model = params.get("model");
  return model && model.trim() ? model.trim() : null;
}

/** Strip provider prefix for display when present (e.g. groq/llama → llama). */
function shortModelId(model: string, provider?: string): string {
  if (provider && model.startsWith(`${provider}/`)) {
    return model.slice(provider.length + 1);
  }
  return model;
}

function RouteMetaBadge({
  meta,
  showRequested = true,
}: {
  meta: ChatRouteMeta;
  showRequested?: boolean;
}) {
  const requested = meta.requestedModel;
  const provider = meta.provider;
  const model = meta.model;
  if (!provider && !model) return null;

  const isMeta = Boolean(requested && META_MODELS.some((m) => m.id === requested));

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
      {showRequested && isMeta && (
        <>
          <span className="text-primary/80">{requested}</span>
          <span className="text-muted-foreground/50">→</span>
        </>
      )}
      {provider && (
        <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
          {provider}
        </span>
      )}
      {model && (
        <span
          className="px-1.5 py-0.5 rounded-md bg-white/[0.04] text-foreground/80 border border-white/[0.08] truncate max-w-[18rem]"
          title={model}
        >
          {shortModelId(model, provider)}
        </span>
      )}
      {meta.cached && (
        <span className="px-1.5 py-0.5 rounded-md bg-primary/5 text-primary/70 border border-primary/15">
          cached
        </span>
      )}
    </div>
  );
}

export default function Chat() {
  const search = useSearch();
  const initialModel = parseInitialModel(search);

  const [modelMode, setModelMode] = useState<"meta" | "direct">(
    initialModel && !META_MODELS.some((m) => m.id === initialModel) ? "direct" : "meta",
  );
  const [metaModel, setMetaModel] = useState<MetaModelId>(
    META_MODELS.some((m) => m.id === initialModel)
      ? (initialModel as MetaModelId)
      : "free",
  );
  const [providerFilter, setProviderFilter] = useState<string>("");
  const [directModel, setDirectModel] = useState<string>(
    initialModel && !META_MODELS.some((m) => m.id === initialModel) ? initialModel : "",
  );
  const [systemPrompt, setSystemPrompt] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [lastRoute, setLastRoute] = useState<ChatRouteMeta | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    data: models,
    isLoading: modelsLoading,
    error: modelsError,
  } = useListModels({
    query: {
      queryKey: getListModelsQueryKey(),
      retry: (failureCount, err) => !isAuthError(err) && failureCount < 2,
    },
  });

  const providerModels = useMemo(() => {
    const all = (models?.data ?? []).filter((m) => m.provider !== "freellm");
    const byProvider = all.reduce<Record<string, typeof all>>((acc, m) => {
      const p = m.provider || "unknown";
      if (!acc[p]) acc[p] = [];
      acc[p].push(m);
      return acc;
    }, {});
    return byProvider;
  }, [models]);

  const providers = useMemo(
    () => Object.keys(providerModels).sort((a, b) => a.localeCompare(b)),
    [providerModels],
  );

  // When landing with ?model=provider/foo, derive provider filter once models load.
  useEffect(() => {
    if (!directModel || providerFilter || providers.length === 0) return;
    const match = (models?.data ?? []).find((m) => m.id === directModel);
    if (match?.provider && match.provider !== "freellm") {
      setProviderFilter(match.provider);
    }
  }, [directModel, providerFilter, providers.length, models?.data]);

  useEffect(() => {
    if (!providerFilter && providers.length > 0 && modelMode === "direct" && !directModel) {
      setProviderFilter(providers[0]);
    }
  }, [providerFilter, providers, modelMode, directModel]);

  const modelsForProvider = providerFilter ? (providerModels[providerFilter] ?? []) : [];

  useEffect(() => {
    if (modelMode !== "direct" || !providerFilter) return;
    if (directModel && modelsForProvider.some((m) => m.id === directModel)) return;
    if (modelsForProvider[0]) setDirectModel(modelsForProvider[0].id);
  }, [modelMode, providerFilter, modelsForProvider, directModel]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const activeModel = modelMode === "meta" ? metaModel : directModel;

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  };

  const clearChat = () => {
    if (sending) stop();
    setMessages([]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !activeModel) return;

    const userMsg: UiMessage = { id: newId(), role: "user", content: text };
    const assistantId = newId();
    const history: UiMessage[] = [...messages, userMsg];

    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const apiMessages: ChatStreamMessage[] = [];
    if (systemPrompt.trim()) {
      apiMessages.push({ role: "system", content: systemPrompt.trim() });
    }
    for (const m of history) {
      apiMessages.push({ role: m.role, content: m.content });
    }

    try {
      const meta = await streamChatCompletion({
        model: activeModel,
        messages: apiMessages,
        signal: controller.signal,
        onMeta: (next) => {
          setLastRoute(next);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, meta: next } : m)),
          );
        },
        onDelta: (delta) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m,
            ),
          );
        },
      });

      setLastRoute(meta);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, meta } : m)),
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content || "(stopped)",
                }
              : m,
          ),
        );
      } else {
        const message = err instanceof Error ? err.message : "Request failed";
        toast.error(message);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content || message,
                  error: true,
                }
              : m,
          ),
        );
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  if (isAuthError(modelsError)) {
    return (
      <ApiKeyGate description="Enter FREELLM_API_KEY (or FREELLM_ADMIN_KEY) to use the chat playground." />
    );
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-6.5rem)] animate-in fade-in duration-500 min-h-[28rem]">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-2xl font-mono font-semibold tracking-tight flex items-center gap-3">
            <MessageSquare className="w-6 h-6 text-primary" />
            Chat
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Try meta-models or a specific provider model through the gateway.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearChat}
          disabled={messages.length === 0 && !sending}
          className="font-mono text-xs gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Clear
        </Button>
      </div>

      {/* Model picker */}
      <div className="rounded-xl border border-white/[0.06] bg-card/80 p-3 md:p-4 space-y-3 shrink-0">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setModelMode("meta")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer",
              modelMode === "meta"
                ? "bg-primary/15 text-primary border border-primary/25"
                : "bg-white/[0.03] text-muted-foreground border border-white/[0.06] hover:text-foreground",
            )}
          >
            Meta models
          </button>
          <button
            type="button"
            onClick={() => setModelMode("direct")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer",
              modelMode === "direct"
                ? "bg-primary/15 text-primary border border-primary/25"
                : "bg-white/[0.03] text-muted-foreground border border-white/[0.06] hover:text-foreground",
            )}
          >
            Provider / model
          </button>
        </div>

        {modelMode === "meta" ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {META_MODELS.map((m) => {
              const active = metaModel === m.id;
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => setMetaModel(m.id)}
                  className={cn(
                    "text-left p-3 rounded-xl border transition-colors cursor-pointer space-y-1",
                    active
                      ? "border-primary/30 bg-primary/[0.08]"
                      : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {m.id === "free-tools" ? (
                      <Wrench className={cn("w-3.5 h-3.5", active ? "text-primary" : "text-muted-foreground")} />
                    ) : m.id === "free-fast" ? (
                      <Zap className={cn("w-3.5 h-3.5", active ? "text-primary" : "text-muted-foreground")} />
                    ) : (
                      <Bot className={cn("w-3.5 h-3.5", active ? "text-primary" : "text-muted-foreground")} />
                    )}
                    <span
                      className={cn(
                        "font-mono text-sm font-semibold",
                        active ? "text-primary" : "text-foreground",
                      )}
                    >
                      {m.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{m.desc}</p>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Provider
              </span>
              <select
                className={selectClass}
                value={providerFilter}
                disabled={modelsLoading || providers.length === 0}
                onChange={(e) => {
                  setProviderFilter(e.target.value);
                  setDirectModel("");
                }}
              >
                {providers.length === 0 ? (
                  <option value="">No providers</option>
                ) : (
                  providers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Model
              </span>
              <select
                className={selectClass}
                value={directModel}
                disabled={modelsLoading || modelsForProvider.length === 0}
                onChange={(e) => setDirectModel(e.target.value)}
              >
                {modelsForProvider.length === 0 ? (
                  <option value="">No models</option>
                ) : (
                  modelsForProvider.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        )}

        <label className="space-y-1.5 block">
          <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            System prompt (optional)
          </span>
          <Input
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful assistant…"
            className="font-mono text-sm bg-background/50"
          />
        </label>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-[11px] font-mono text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Requested</span>
            <Badge
              variant="outline"
              className="font-mono text-[11px] border-primary/20 text-primary bg-primary/5"
            >
              {activeModel || "—"}
            </Badge>
          </div>
          {lastRoute && (lastRoute.provider || lastRoute.model) && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0">Routed to</span>
              <RouteMetaBadge meta={lastRoute} showRequested={false} />
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full min-h-[12rem] flex flex-col items-center justify-center text-center gap-2 px-4">
              <MessageSquare className="w-8 h-8 text-muted-foreground/40" />
              <p className="font-mono text-sm text-muted-foreground">
                Send a message to test routing
              </p>
              <p className="text-xs text-muted-foreground/70 max-w-sm">
                Responses show which provider and concrete model served the request.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex gap-3",
                  m.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {m.role === "assistant" && (
                  <div className="mt-0.5 w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[min(40rem,85%)] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed space-y-2",
                    m.role === "user"
                      ? "bg-primary/15 border border-primary/20 text-foreground"
                      : m.error
                        ? "bg-destructive/10 border border-destructive/25 text-destructive"
                        : "bg-white/[0.03] border border-white/[0.06] text-foreground/90",
                  )}
                >
                  {m.role === "assistant" && m.meta && (m.meta.provider || m.meta.model) && (
                    <RouteMetaBadge meta={m.meta} />
                  )}
                  <div className="whitespace-pre-wrap break-words">
                    {m.content || (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground font-mono text-xs">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {m.meta?.provider
                          ? `Routing via ${m.meta.provider}…`
                          : "Selecting provider…"}
                      </span>
                    )}
                  </div>
                </div>
                {m.role === "user" && (
                  <div className="mt-0.5 w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="border-t border-white/[0.06] p-3 flex gap-2 items-end bg-sidebar/40"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Message… (Enter to send, Shift+Enter for newline)"
            disabled={sending || !activeModel}
            className={cn(
              "flex-1 resize-none rounded-xl border border-white/[0.08] bg-background/60 px-3.5 py-2.5 text-sm font-sans",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              "disabled:opacity-50",
            )}
          />
          {sending ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={stop}
              className="shrink-0 h-10 w-10"
              title="Stop"
            >
              <Square className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || !activeModel}
              className="shrink-0 h-10 w-10"
              title="Send"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
