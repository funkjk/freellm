import { describe, expect, it } from "vitest";
import { MemoryRequestMetricsStore } from "../src/stores/request-metrics/memory.js";
import { MemoryRequestLogStore } from "../src/stores/request-log/memory.js";
import { MemoryRoutingConfigStore } from "../src/stores/routing-config/memory.js";
import { RequestLog } from "../src/observability/request-log.js";

describe("MemoryRequestMetricsStore 24h outcomes", () => {
  it("aggregates success / failed / rate_limited per provider and gateway", async () => {
    const store = new MemoryRequestMetricsStore();
    await store.record("gemini", "success");
    await store.record("gemini", "success");
    await store.record("gemini", "rate_limited");
    await store.record("groq", "failed");

    const gemini = await store.getTotals("gemini");
    expect(gemini).toEqual({
      totalRequests: 3,
      successRequests: 2,
      failedRequests: 0,
      rateLimitedRequests: 1,
    });

    const { gateway, byProvider } = await store.getAllTotals();
    expect(byProvider.groq?.failedRequests).toBe(1);
    expect(gateway.totalRequests).toBe(4);
    expect(gateway.successRequests).toBe(2);
    expect(gateway.failedRequests).toBe(1);
    expect(gateway.rateLimitedRequests).toBe(1);
  });
});

describe("RequestLog persistence hooks", () => {
  it("writes recent entries and outcome metrics", async () => {
    const logStore = new MemoryRequestLogStore(10);
    const metrics = new MemoryRequestMetricsStore();
    const log = new RequestLog({ store: logStore, metrics });

    log.add({
      requestedModel: "free-smart",
      resolvedModel: "gemini/gemini-3.6-flash",
      provider: "gemini",
      latencyMs: 12,
      status: "success",
      streaming: false,
    });
    log.add({
      requestedModel: "free-smart",
      provider: "gemini",
      latencyMs: 5,
      status: "rate_limited",
      streaming: false,
    });

    // allow fire-and-forget persist
    await new Promise((r) => setTimeout(r, 20));

    const recent = await log.getRecent(10);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.status).toBe("rate_limited");

    const outcomes = await log.getOutcomeTotals();
    expect(outcomes.byProvider.gemini?.successRequests).toBe(1);
    expect(outcomes.byProvider.gemini?.rateLimitedRequests).toBe(1);
    expect(outcomes.gateway.totalRequests).toBe(2);
  });
});

describe("MemoryRoutingConfigStore", () => {
  it("persists strategy in-process", async () => {
    const store = new MemoryRoutingConfigStore();
    expect(await store.getStrategy()).toBe("round_robin");
    await store.setStrategy("random");
    expect(await store.getStrategy()).toBe("random");
  });
});
