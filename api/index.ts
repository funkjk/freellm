/**
 * Vercel serverless entry when the project Root Directory is the monorepo
 * root (`.`). Prefer setting Root Directory to `apps/gateway` instead; this
 * exists so a mis-scoped project still serves the gateway + dashboard.
 */
export { default } from "../apps/gateway/api/index.js";
