/**
 * Dashboard API key stored in sessionStorage.
 *
 * When FREELLM_API_KEY / FREELLM_ADMIN_KEY / virtual keys are configured,
 * gateway API routes require Authorization. The SPA cannot send that on
 * first navigation, so the operator pastes the key here and we attach it
 * on subsequent fetch calls.
 */

const STORAGE_KEY = "freellm.dashboard.apiKey";
const CHANGE_EVENT = "freellm:api-key-change";

export function getApiKey(): string | null {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  const trimmed = key.trim();
  try {
    if (trimmed) {
      sessionStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Private mode / blocked storage — still notify so in-memory UI updates.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearApiKey(): void {
  setApiKey("");
}

/** Headers to merge into dashboard API requests. */
export function getAuthHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export function subscribeApiKey(onStoreChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { error?: { code?: unknown } }).error?.code;
  return code === "missing_api_key" || code === "invalid_api_key" || code === "admin_required";
}
