import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDashboardDir } from "../src/dashboard-path.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDashboardDir", () => {
  it("returns null when no candidate has index.html", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "freellm-dash-"));
    created.push(tmp);
    const gatewaySrc = path.join(tmp, "apps", "gateway", "src");
    fs.mkdirSync(gatewaySrc, { recursive: true });
    const meta = pathToFileURL(path.join(gatewaySrc, "app.ts")).href;
    expect(resolveDashboardDir({ metaUrl: meta, cwd: tmp })).toBeNull();
  });

  it("finds dashboard relative to gateway src layout", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "freellm-dash-"));
    created.push(tmp);
    const gatewaySrc = path.join(tmp, "apps", "gateway", "src");
    const dashPublic = path.join(tmp, "apps", "dashboard", "dist", "public");
    fs.mkdirSync(gatewaySrc, { recursive: true });
    fs.mkdirSync(dashPublic, { recursive: true });
    fs.writeFileSync(path.join(dashPublic, "index.html"), "<html></html>");
    const meta = pathToFileURL(path.join(gatewaySrc, "app.ts")).href;
    const resolved = resolveDashboardDir({ metaUrl: meta, cwd: path.join(tmp, "empty") });
    expect(resolved).toBe(path.resolve(dashPublic));
  });
});
