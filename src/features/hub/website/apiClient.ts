import {
  clearAccountAuthToken,
  readAccountAuthToken,
  saveAccountAuthToken,
} from "../../account/shared/authTokenStore";

const legacyHubAuthTokenStorageKey = "misty:hub-auth-token";

export function hubApiBase(): string {
  const base = normalizeBaseUrl(import.meta.env.VITE_API_BASE)
    || normalizeBaseUrl(import.meta.env.VITE_MISTY_SERVER_URL);
  if (!base) return "";
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

export async function saveHubAuthToken(token: string | null | undefined): Promise<void> {
  clearLegacyHubAuthToken();
  if (!token) return;
  await saveAccountAuthToken(token);
}

export async function clearHubAuthToken(): Promise<void> {
  clearLegacyHubAuthToken();
  await clearAccountAuthToken();
}

export async function hubApiHeaders(initHeaders?: HeadersInit, authenticated = true): Promise<Headers> {
  const headers = new Headers(initHeaders);
  const token = authenticated ? await readAccountAuthToken() : null;
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function clearLegacyHubAuthToken(): void {
  try {
    localStorage.removeItem(legacyHubAuthTokenStorageKey);
  } catch {
    // Browser cookie auth and keychain auth do not require localStorage cleanup.
  }
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}
