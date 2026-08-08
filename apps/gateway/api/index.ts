/**
 * Vercel serverless entry. Boots stores once per isolate, then serves Express.
 *
 * Streaming keep-alive is unchanged; if Vercel maxDuration cuts the request,
 * the client sees a truncated stream — no resume protocol.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../src/app.js";
import { bootGateway } from "../src/boot.js";
import { logger } from "../src/logger.js";

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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await ensureBoot();
  app(req as never, res as never);
}
