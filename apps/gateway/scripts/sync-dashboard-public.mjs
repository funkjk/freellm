/**
 * Copy the Vite dashboard build into apps/gateway/public so Vercel can
 * serve it as static CDN assets alongside the /api serverless function.
 *
 * Usage (from apps/gateway or repo root):
 *   node apps/gateway/scripts/sync-dashboard-public.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(here, "..");
const src = path.resolve(gatewayRoot, "../dashboard/dist/public");
const dest = path.resolve(gatewayRoot, "public");

if (!fs.existsSync(path.join(src, "index.html"))) {
  console.error(
    `Dashboard build missing at ${src}. Run: pnpm --filter @freellm/dashboard build`,
  );
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`Synced dashboard → ${dest}`);
