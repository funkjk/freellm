/**
 * Monorepo-root Vercel entry when Root Directory is `.`.
 * Prefer Root Directory `apps/gateway`; this keeps a mis-scoped project working.
 */
export { default } from "../apps/gateway/dist/vercel-api.mjs";
