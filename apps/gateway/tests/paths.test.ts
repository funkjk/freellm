import { describe, expect, it } from "vitest";
import { isApiPath, isHealthPath } from "../src/middleware/paths.js";

describe("isHealthPath", () => {
  it("matches health endpoints", () => {
    expect(isHealthPath("/healthz")).toBe(true);
    expect(isHealthPath("/api/healthz")).toBe(true);
  });

  it("rejects other paths", () => {
    expect(isHealthPath("/")).toBe(false);
    expect(isHealthPath("/v1/status")).toBe(false);
  });
});

describe("isApiPath", () => {
  it("treats /v1 and /api routes as API", () => {
    expect(isApiPath("/v1")).toBe(true);
    expect(isApiPath("/v1/status")).toBe(true);
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/v1/models")).toBe(true);
  });

  it("excludes health even under /api", () => {
    expect(isApiPath("/healthz")).toBe(false);
    expect(isApiPath("/api/healthz")).toBe(false);
  });

  it("excludes dashboard static and SPA routes", () => {
    expect(isApiPath("/")).toBe(false);
    expect(isApiPath("/models")).toBe(false);
    expect(isApiPath("/assets/index.js")).toBe(false);
    expect(isApiPath("/favicon.ico")).toBe(false);
  });
});
