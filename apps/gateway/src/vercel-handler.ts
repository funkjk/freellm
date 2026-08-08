/**
 * Vercel serverless handler source. Bundled to dist/vercel-api.mjs so Vercel
 * never typechecks the Express app (Express 5 + pnpm breaks @vercel/node's tsc).
 */
import app from "./app.js";
import { bootGateway } from "./boot.js";
import { logger } from "./logger.js";

let ready: Promise<void> | null = null;

function ensureBoot(): Promise<void> {
  if (!ready) {
    ready = bootGateway().catch((err) => {
      ready = null;
      logger.error({ err }, "vercel boot failed");
      throw err;
    });
  }
  return ready;
}

export default async function handler(req: unknown, res: unknown): Promise<void> {
  await ensureBoot();
  app(req as never, res as never);
}
