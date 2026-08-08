/**
 * Path helpers shared by auth and rate-limit middleware.
 *
 * Static dashboard assets and SPA routes are served from the same Express
 * process as the API. Browsers cannot attach Authorization on a normal
 * navigation, so only API paths enforce credentials.
 */

export function isHealthPath(path: string): boolean {
  return path === "/healthz" || path === "/api/healthz";
}

/** True for gateway API routes that must authenticate when a key is configured. */
export function isApiPath(path: string): boolean {
  if (isHealthPath(path)) return false;
  return path === "/v1" || path.startsWith("/v1/") || path === "/api" || path.startsWith("/api/");
}
