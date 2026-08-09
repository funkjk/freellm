# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public GitHub issue.** Instead, use one of these channels:

1. **Preferred:** [GitHub Private Vulnerability Reporting](https://github.com/Devansh-365/freellm/security/advisories/new)
2. **Email:** devansh@trymetis.app

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Affected component (gateway router, provider adapter, middleware, dashboard, website)
- The version (or commit SHA) you're reporting against

### Response Timeline

| Step | Timeframe |
|---|---|
| Acknowledgment of your report | Within 48 hours |
| Initial assessment and severity rating | Within 5 business days |
| Fix developed and tested | Within 14 business days (severity dependent) |
| Public disclosure | After fix is deployed, coordinated with reporter |

### Responsible Disclosure

We ask that you give us a reasonable window (up to 90 days) to address the issue before any public disclosure. We will coordinate the disclosure timeline with you and credit you in the release notes (unless you prefer anonymity).

If we are unresponsive for more than 14 days, you may escalate by opening a private advisory on this repository.

## Architecture and Attack Surface

FreeLLM is a self-hosted gateway that proxies requests to upstream LLM providers. Users run their own instance, control their own API keys, and never send data to FreeLLM-controlled infrastructure.

| Area | Risk Level | Notes |
|---|---|---|
| Gateway authentication bypass | Medium | Optional API key auth — see `FREELLM_API_KEY` |
| Provider API key exposure | High | Keys are read from env vars and forwarded as `Authorization: Bearer` to upstream providers |
| Upstream error leakage | Low | Mitigated — only the `error.message` field is forwarded to clients, never the raw upstream JSON |
| SSRF via Ollama base URL | Medium | `OLLAMA_BASE_URL` is operator-controlled, but should be validated when set from untrusted sources |
| Per-client rate limiting bypass | Medium | Mitigated — `express-rate-limit` keyed on IP, with `trust proxy` set so reverse proxies forward the real client IP |
| Body size DoS | Low | Mitigated — `express.json({ limit: "1mb" })` and Zod schema with `messages.max(256)` |
| Timing attacks on API key | Mitigated | `crypto.timingSafeEqual()` with SHA-256 hashed buffers |
| CORS abuse | Medium | Operator-configurable via `ALLOWED_ORIGINS`. When unset, the gateway allows all origins |
| Cache poisoning | Low | Cache is in-memory, keyed by request hash, only successful 2xx responses are stored |
| Supply chain | Medium | Third-party npm dependencies, all pinned via `pnpm-lock.yaml` |

## Mitigations in Place

- **Timing-safe API key comparison:** `auth.ts` uses `crypto.timingSafeEqual()` on SHA-256 hashes of both the supplied and configured key, preventing single-character timing leaks
- **Upstream error sanitization:** `error-handler.ts` extracts only the `error.message` string from upstream responses, never forwards raw provider JSON to clients
- **Body size limits:** `express.json({ limit: "1mb" })` and `express.urlencoded({ limit: "1mb" })` reject oversized payloads before parsing
- **Strict Zod validation:** `chatCompletionRequestSchema` uses `.strict()`, caps `messages.max(256)`, caps `max_tokens.max(32768)`
- **Per-client rate limiting:** `express-rate-limit` with configurable `RATE_LIMIT_RPM` (default 60) and `RATE_LIMIT_WINDOW_MS` (default 60s), keyed on `req.ip` with `trust proxy` enabled
- **Per-provider rate limiting:** sliding-window per-key tracker prevents the gateway from exceeding upstream free-tier limits
- **Circuit breakers:** failing providers are taken out of rotation after 3 consecutive failures with a 30s recovery window, preventing cascading failures
- **Routing deadline:** `ROUTE_TIMEOUT_MS` (default 30s) prevents requests from hanging indefinitely during cascading provider failures
- **Admin endpoint isolation:** circuit breaker reset and routing strategy mutations require a separate `FREELLM_ADMIN_KEY` distinct from the regular API key
- **Non-root Docker container:** the production image runs as `appuser` (UID 1001), not root
- **No native modules:** zero dependencies require `node-gyp`, eliminating an entire class of supply-chain risks (see the LiteLLM PyPI compromise of late 2025)
- **Pinned dependencies:** `pnpm-lock.yaml` is committed and deploy builds use the lockfile
- **Multi-arch signed Docker images:** built and pushed via GitHub Actions to `ghcr.io/devansh-365/freellm` with attestations

## Scope

### In Scope

- Vulnerabilities in FreeLLM's gateway, middleware, or routing logic
- Authentication or authorization bypasses
- Information disclosure (especially provider API keys, internal config, or upstream error details)
- Cache poisoning or cache key collisions
- Server-side request forgery (SSRF) via configurable URLs
- Denial of service that survives the existing rate limits
- Dependencies with known CVEs that affect FreeLLM's usage
- Dashboard XSS, prototype pollution, or unsafe rendering
- Build/CI vulnerabilities (Dockerfile, GitHub Actions)

### Out of Scope

- Vulnerabilities in upstream LLM providers (Groq, Gemini, Mistral, NVIDIA NIM) — report those to the providers directly
- Issues that require an attacker to already have valid `FREELLM_API_KEY` AND `FREELLM_ADMIN_KEY`
- Social engineering attacks against operators
- Physical access to the operator's host
- Self-XSS in the dashboard (operator paste-in-console)
- Vulnerabilities in browsers, operating systems, or container runtimes
- Issues in third-party services (Railway, Render, GHCR, Cloudflare) — report those to the platforms directly
- Configuration mistakes by operators (running without `FREELLM_API_KEY` in production, exposing the dashboard publicly without `ALLOWED_ORIGINS`, etc.)

## Supported Versions

Only the latest tagged release on `main` is supported with security fixes. There is no LTS branch.

Current latest: see the [Releases page](https://github.com/Devansh-365/freellm/releases).

## Recognition

We will credit security researchers in the changelog and release notes (with your permission). Significant findings will be acknowledged in the project's GitHub Security Advisories.

## References

This policy is informed by the [OpenSSF Vulnerability Disclosure Guide](https://github.com/ossf/oss-vulnerability-guide) and [GitHub's coordinated disclosure documentation](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/about-coordinated-disclosure-of-security-vulnerabilities).
