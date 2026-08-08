export interface TokenUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
}

export interface UsageTrackerStore {
  record(providerId: string, promptTokens: number, completionTokens: number): Promise<void>;
  getTotals(providerId: string): Promise<TokenUsageTotals>;
  getAllTotals(): Promise<{
    byProvider: Record<string, TokenUsageTotals>;
    gateway: TokenUsageTotals;
  }>;
  reset(): Promise<void>;
}
