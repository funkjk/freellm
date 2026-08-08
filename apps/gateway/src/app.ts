import path from "node:path";
import compression from "compression";
import cors from "cors";
import express, { type Express, type Request } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { resolveDashboardDir } from "./dashboard-path.js";
import { logger } from "./logger";
import { auth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { identifierLimit } from "./middleware/identifier-limit.js";
import { clientRateLimit } from "./middleware/rate-limit.js";
import { requestId } from "./middleware/request-id.js";
import router from "./routes";

const app: Express = express();

// Trust reverse proxy (Railway, Render, etc.) so req.ip is the real client IP
app.set("trust proxy", 1);

// Security headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(
  helmet({
    contentSecurityPolicy: false, // disabled: dashboard is a SPA served as static files
  }),
);

// Response compression for JSON/SSE payloads
app.use(compression());

// Request ID FIRST — must run before body-parser so errors thrown by
// express.json() (e.g. SyntaxError on malformed JSON) still carry an id.
app.use(requestId);

// CORS: restrict origins in production via ALLOWED_ORIGINS env var
const allowedOrigins = process.env.ALLOWED_ORIGINS;
app.use(
  cors(
    allowedOrigins
      ? { origin: allowedOrigins.split(",").map((o) => o.trim()), credentials: true }
      : undefined,
  ),
);

app.use(
  pinoHttp({
    logger,
    // Reuse the id assigned by the request-id middleware so a single
    // request_id threads through access logs, error logs, and responses.
    genReqId: (req) => (req as Request).id,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Per-client rate limiting (by IP)
app.use(clientRateLimit);

// API key auth: only enforced for /v1 and /api routes when FREELLM_API_KEY
// is set OR virtual keys are loaded. Dashboard static assets stay public so
// browsers can load the SPA; the UI attaches Bearer for subsequent API calls.
app.use(auth);

// Per-identifier rate limit runs AFTER auth so it only sees authenticated
// traffic. Health checks are exempt internally.
app.use(identifierLimit);

// Mount at /api (used by dashboard via proxy) and also at root (direct SDK access: base_url="/v1")
app.use("/api", router);
app.use("/", router);

app.use(errorHandler);

// In production (and local gateway-only runs), serve the dashboard SPA from
// the same process. Dev usually uses Vite on :5173 instead.
const dashboardDir = resolveDashboardDir();
if (dashboardDir) {
  logger.info({ dashboardDir }, "serving dashboard static files");
  app.use(express.static(dashboardDir));
  // SPA fallback: serve index.html for any unmatched route (client-side routing)
  app.use((_req, res, next) => {
    res.sendFile(path.join(dashboardDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });
} else {
  logger.warn(
    "dashboard build not found (apps/dashboard/dist/public). GET / will not serve the UI. Run `pnpm --filter @freellm/dashboard build` or use Vite on :5173.",
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/v1") || req.path.startsWith("/api")) {
      next();
      return;
    }
    res
      .status(503)
      .type("html")
      .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>FreeLLM — dashboard not built</title>
<style>
  body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f1117;color:#e8e6dc;padding:3rem;line-height:1.5}
  code{background:#1a1d27;padding:.15rem .4rem;border-radius:4px}
  a{color:#3ecf8e}
</style></head><body>
  <h1>Dashboard not built</h1>
  <p>The gateway is running, but <code>apps/dashboard/dist/public</code> is missing.</p>
  <p>Build it, then restart:</p>
  <p><code>pnpm --filter @freellm/dashboard build</code></p>
  <p>Or in local development open the Vite app at <a href="http://localhost:5173">http://localhost:5173</a>.</p>
  <p>API health: <a href="/healthz">/healthz</a></p>
</body></html>`);
  });
}

export default app;
