import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ModelRateStatus } from "@/api/schemas";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, Clock, Coins, Key, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

interface ProviderCardProps {
  provider: {
    id: string;
    name: string;
    enabled: boolean;
    disabled?: boolean;
    circuitBreakerState: string;
    successRequests: number;
    failedRequests: number;
    lastError?: string | null;
    lastUsedAt?: string | null;
    keyCount?: number;
    keysAvailable?: number;
    rateLimitScope?: "key" | "model";
    modelStatus?: ModelRateStatus[];
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      requestCount: number;
    };
    privacy?: {
      policy: string;
      sourceUrl: string;
      lastVerified: string;
    };
  };
  onReset: (providerId: string) => void;
  resetPending: boolean;
  onSetDisabled: (providerId: string, disabled: boolean) => void;
  disablePending: boolean;
}

function getPrivacyStyle(policy: string) {
  switch (policy) {
    case "no-training":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "local":
      return "bg-sky-500/10 text-sky-400 border-sky-500/20";
    case "configurable":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "free-tier-trains":
      return "bg-rose-500/10 text-rose-400 border-rose-500/20";
    default:
      return "bg-muted text-muted-foreground border-border/50";
  }
}

function getPrivacyLabel(policy: string) {
  switch (policy) {
    case "no-training":
      return "NO-TRAIN";
    case "local":
      return "LOCAL";
    case "configurable":
      return "CONFIG";
    case "free-tier-trains":
      return "TRAINS";
    default:
      return policy.toUpperCase();
  }
}

function getStatusColor(state: string, enabled: boolean, manuallyDisabled: boolean) {
  if (!enabled) return "bg-muted text-muted-foreground border-muted";
  if (manuallyDisabled) return "bg-rose-500/10 text-rose-400 border-rose-500/20";
  switch (state) {
    case "closed":
      return "bg-primary/10 text-primary border-primary/15";
    case "open":
      return "bg-destructive/10 text-destructive border-destructive/15";
    case "half_open":
      return "bg-amber-500/10 text-amber-400 border-amber-500/15";
    default:
      return "bg-muted text-muted-foreground border-muted";
  }
}

function getStatusText(state: string, enabled: boolean, manuallyDisabled: boolean) {
  if (!enabled) return "No keys";
  if (manuallyDisabled) return "Disabled";
  switch (state) {
    case "closed":
      return "Healthy";
    case "open":
      return "Failing";
    case "half_open":
      return "Testing";
    default:
      return "Unknown";
  }
}

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

function formatRetryAfter(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "";
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem > 0 ? `${hr}h ${rem}m` : `${hr}h`;
}

function shortModelId(fullId: string, providerId: string): string {
  const prefix = `${providerId}/`;
  return fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
}

export function ProviderCard({
  provider,
  onReset,
  resetPending,
  onSetDisabled,
  disablePending,
}: ProviderCardProps) {
  const keyCount = provider.keyCount ?? 1;
  const keysAvailable = provider.keysAvailable ?? keyCount;
  const hasMultiKey = keyCount > 1;
  const usage = provider.usage;
  const hasTokens = usage && usage.totalTokens > 0;
  const manuallyDisabled = provider.disabled === true;
  const modelStatus = provider.modelStatus ?? [];
  const showModels = provider.rateLimitScope === "model" && modelStatus.length > 0;
  const limitedCount = modelStatus.filter((m) => m.rateLimited).length;
  const [modelsOpen, setModelsOpen] = useState(limitedCount > 0);

  const sortedModels = useMemo(() => {
    return [...modelStatus].sort((a, b) => {
      if (a.rateLimited !== b.rateLimited) return a.rateLimited ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  }, [modelStatus]);

  return (
    <div
      className={cn(
        "rounded-xl border border-white/[0.04] bg-card p-5 transition-all duration-200 hover:border-white/[0.08]",
        (!provider.enabled || manuallyDisabled) && "opacity-50",
      )}
    >
      {/* Header */}
      <div className="flex justify-between items-start gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-mono text-base font-semibold tracking-tight">{provider.name}</h3>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">{provider.id}</p>
        </div>
        <div className="flex flex-wrap items-start gap-1.5 justify-end shrink-0">
          <Badge
            variant="outline"
            className={cn(
              "uppercase text-[10px] tracking-wider",
              getStatusColor(provider.circuitBreakerState, provider.enabled, manuallyDisabled),
            )}
          >
            {getStatusText(provider.circuitBreakerState, provider.enabled, manuallyDisabled)}
          </Badge>
          {showModels && (
            <Badge
              variant="outline"
              className={cn(
                "uppercase text-[10px] tracking-wider",
                limitedCount > 0
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-white/[0.03] text-muted-foreground border-white/[0.06]",
              )}
              title={`${modelStatus.length - limitedCount}/${modelStatus.length} models available`}
            >
              {modelStatus.length - limitedCount}/{modelStatus.length} mdl
            </Badge>
          )}
          {hasMultiKey && (
            <Badge
              variant="outline"
              className="uppercase text-[10px] tracking-wider bg-white/[0.03] text-muted-foreground border-white/[0.06] flex items-center gap-1"
              title={`${keysAvailable}/${keyCount} keys available`}
            >
              <Key className="w-2.5 h-2.5" />
              {keysAvailable}/{keyCount}
            </Badge>
          )}
          {provider.privacy && (
            <a
              href={provider.privacy.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`Training policy: ${provider.privacy.policy}\nVerified ${provider.privacy.lastVerified}`}
            >
              <Badge
                variant="outline"
                className={cn(
                  "uppercase text-[10px] tracking-wider flex items-center gap-1 cursor-help",
                  getPrivacyStyle(provider.privacy.policy),
                )}
              >
                <ShieldCheck className="w-2.5 h-2.5" />
                {getPrivacyLabel(provider.privacy.policy)}
              </Badge>
            </a>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-sm font-mono mb-4">
        <div className="flex flex-col gap-0.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
            Success
          </span>
          <span className="text-foreground font-medium">{provider.successRequests}</span>
        </div>
        <div className="flex flex-col gap-0.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Failed</span>
          <span
            className={cn(
              "font-medium",
              provider.failedRequests > 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {provider.failedRequests}
          </span>
        </div>
      </div>

      {/* Per-model rate-limit state (model-scoped providers only) */}
      {showModels && (
        <div className="mb-4 rounded-lg border border-white/[0.04] bg-white/[0.015] overflow-hidden">
          <button
            type="button"
            onClick={() => setModelsOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/[0.02]"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              Models {limitedCount > 0 ? `· ${limitedCount} cooling` : "· all clear"}
            </span>
            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 text-muted-foreground transition-transform",
                modelsOpen && "rotate-180",
              )}
            />
          </button>
          {modelsOpen && (
            <ul className="border-t border-white/[0.04] divide-y divide-white/[0.03] max-h-48 overflow-y-auto">
              {sortedModels.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 font-mono text-[11px]"
                >
                  <span className="truncate text-foreground/90" title={m.id}>
                    {shortModelId(m.id, provider.id)}
                  </span>
                  {m.rateLimited ? (
                    <span className="shrink-0 text-amber-400/90">
                      {formatRetryAfter(m.retryAfterMs) || "limited"}
                    </span>
                  ) : (
                    <span className="shrink-0 text-emerald-400/80">ok</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tokens */}
      {hasTokens && usage && (
        <div className="p-3 rounded-lg border border-amber-500/10 bg-amber-500/[0.03] mb-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase text-amber-400/70 tracking-wider mb-1.5">
            <Coins className="w-3 h-3" /> Tokens (24h)
          </div>
          <div className="font-mono text-sm text-amber-400 font-medium">
            {formatCompact(usage.totalTokens)}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
            in {formatCompact(usage.promptTokens)} · out {formatCompact(usage.completionTokens)}
          </div>
        </div>
      )}

      {/* Error */}
      {provider.lastError && (
        <div className="p-2.5 rounded-lg border border-destructive/10 bg-destructive/[0.03] text-xs text-destructive/80 flex items-start gap-2 overflow-hidden mb-4">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="truncate" title={provider.lastError}>
            {provider.lastError}
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.04]">
        <div className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 min-w-0">
          <Clock className="w-3 h-3 shrink-0" />
          {provider.lastUsedAt ? new Date(provider.lastUsedAt).toLocaleTimeString() : "Never"}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {provider.enabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReset(provider.id)}
              disabled={resetPending}
              title="Clear circuit breaker, rate-limit cooldowns, quota streaks, and sliding windows"
              className="h-7 text-xs rounded-lg border-white/[0.08] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
            >
              <RefreshCw className={cn("w-3 h-3 mr-1", resetPending && "animate-spin")} /> Reset
            </Button>
          )}
          <label
            className={cn(
              "flex items-center gap-2 text-[11px] font-mono",
              provider.enabled ? "text-muted-foreground" : "text-muted-foreground/50",
            )}
            title={
              provider.enabled
                ? manuallyDisabled
                  ? "Enable routing to this provider"
                  : "Disable routing to this provider"
                : "Configure API keys before enabling"
            }
          >
            <span>{manuallyDisabled ? "Off" : "On"}</span>
            <Switch
              checked={provider.enabled && !manuallyDisabled}
              disabled={!provider.enabled || disablePending}
              onCheckedChange={(checked) => onSetDisabled(provider.id, !checked)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
