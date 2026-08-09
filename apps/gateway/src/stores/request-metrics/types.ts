export interface OutcomeTotals {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
}

export type OutcomeKind = "success" | "failed" | "rate_limited";

export interface RequestMetricsStore {
  record(providerId: string, kind: OutcomeKind): Promise<void>;
  getTotals(providerId: string): Promise<OutcomeTotals>;
  getAllTotals(): Promise<{
    byProvider: Record<string, OutcomeTotals>;
    gateway: OutcomeTotals;
  }>;
  reset(): Promise<void>;
}

export function emptyOutcomeTotals(): OutcomeTotals {
  return {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
  };
}

export function outcomeKindFromStatus(
  status: "success" | "error" | "rate_limited" | "all_providers_failed",
): OutcomeKind {
  if (status === "success") return "success";
  if (status === "rate_limited" || status === "all_providers_failed") return "rate_limited";
  return "failed";
}
