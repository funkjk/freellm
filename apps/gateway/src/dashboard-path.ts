import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolveDashboardDirOptions {
  metaUrl?: string;
  cwd?: string;
}

/**
 * Resolve the built dashboard directory across local tsx (src/), bundled
 * dist/, Docker WORKDIR, and monorepo-root cwd layouts.
 */
export function resolveDashboardDir(options: ResolveDashboardDirOptions = {}): string | null {
  const metaUrl = options.metaUrl ?? import.meta.url;
  const cwd = options.cwd ?? process.cwd();
  const here = path.dirname(fileURLToPath(metaUrl));
  const candidates = [
    // apps/gateway/src → apps/dashboard/dist/public
    // apps/gateway/dist → apps/dashboard/dist/public
    path.resolve(here, "../../dashboard/dist/public"),
    // cwd = apps/gateway (Docker / package scripts)
    path.resolve(cwd, "../dashboard/dist/public"),
    // cwd = monorepo root
    path.resolve(cwd, "apps/dashboard/dist/public"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return null;
}
