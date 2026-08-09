import type { Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * When FREELLM_API_KEY is set, API routes still require Authorization, but
 * dashboard static / SPA paths must remain reachable from a browser.
 */
let app: Express;

beforeAll(async () => {
  process.env.FREELLM_API_KEY = "test-key-for-dashboard-static-auth";
  process.env.DISABLE_CLIENT_RATELIMIT = "true";
  process.env.RATE_LIMIT_RPM = "100000";
  process.env.FREELLM_IDENTIFIER_LIMIT = "1000/60000";
  delete process.env.FREELLM_ADMIN_KEY;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODELS;
  for (const k of [
    "GROQ_API_KEY",
    "GEMINI_API_KEY",
    "MISTRAL_API_KEY",
    "NIM_API_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_KEY",
    "GITHUB_MODELS_API_KEY",
  ]) {
    delete process.env[k];
  }

  const mod = await import("../src/app.js");
  app = mod.default;
});

describe("dashboard static paths stay unauthenticated", () => {
  it("serves the dashboard HTML for GET / without Authorization", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toMatch(/FreeLLM|root|id="root"/i);
  });

  it("serves SPA fallback for /models without Authorization", async () => {
    const res = await request(app).get("/models");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
  });

  it("does not require Authorization for missing asset paths", async () => {
    const res = await request(app).get("/assets/index-abc123.js");
    // 404 from static is fine; must not be auth rejection
    expect(res.status).not.toBe(401);
    expect(res.body?.error?.code).not.toBe("missing_api_key");
  });
});

describe("API paths still require Authorization", () => {
  it("rejects unauthenticated /v1/status", async () => {
    const res = await request(app).get("/v1/status");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("missing_api_key");
  });

  it("rejects unauthenticated /api/v1/status", async () => {
    const res = await request(app).get("/api/v1/status");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("missing_api_key");
  });

  it("accepts master key on /api/v1/status", async () => {
    const res = await request(app)
      .get("/api/v1/status")
      .set("authorization", "Bearer test-key-for-dashboard-static-auth");
    expect(res.status).toBe(200);
  });
});
