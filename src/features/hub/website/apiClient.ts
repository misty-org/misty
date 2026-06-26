const authTokenStorageKey = "misty:hub-auth-token";

export function hubApiBase(): string {
  const base = normalizeBaseUrl(import.meta.env.VITE_API_BASE)
    || normalizeBaseUrl(import.meta.env.VITE_MISTY_SERVER_URL);
  if (!base) return "";
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

export function readHubAuthToken(): string | null {
  try {
    return localStorage.getItem(authTokenStorageKey);
  } catch {
    return null;
  }
}

export function saveHubAuthToken(token: string | null | undefined): void {
  if (!token) return;
  try {
    localStorage.setItem(authTokenStorageKey, token);
  } catch {
    // Auth still works for cookie-based servers when localStorage is unavailable.
  }
}

export function clearHubAuthToken(): void {
  try {
    localStorage.removeItem(authTokenStorageKey);
  } catch {
    // Nothing to clear when localStorage is unavailable.
  }
}

export function hubApiHeaders(initHeaders?: HeadersInit, authenticated = true): Headers {
  const headers = new Headers(initHeaders);
  const token = authenticated ? readHubAuthToken() : null;
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}
