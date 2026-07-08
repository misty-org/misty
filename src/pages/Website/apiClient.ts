import {
  clearAccountAuthToken,
  readAccountAuthToken,
  saveAccountAuthToken,
} from "../Account/shared/authTokenStore";
import { appSnapshot } from "../../api/misty";

const legacyAuthTokenStorageKey = "misty:auth-token";

export async function appApiBase(): Promise<string> {
  const base = normalizeBaseUrl(import.meta.env.VITE_API_BASE)
    || normalizeBaseUrl(import.meta.env.VITE_MISTY_SERVER_URL)
    || normalizeBaseUrl((await loadAppSnapshotForApi())?.environment.serverUrl);
  if (!base) {
    throw new Error("Misty server URL is not configured. Set VITE_API_BASE or add server.url to your Misty config.");
  }
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

export async function saveAppAuthToken(token: string | null | undefined): Promise<void> {
  clearLegacyAuthToken();
  if (!token) return;
  await saveAccountAuthToken(token);
}

export async function clearAppAuthToken(): Promise<void> {
  clearLegacyAuthToken();
  await clearAccountAuthToken();
}

export async function appApiHeaders(initHeaders?: HeadersInit, authenticated = true): Promise<Headers> {
  const headers = new Headers(initHeaders);
  const token = authenticated ? await readAccountAuthToken() : null;
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function clearLegacyAuthToken(): void {
  try {
    localStorage.removeItem(legacyAuthTokenStorageKey);
  } catch {
    // Browser cookie auth and keychain auth do not require localStorage cleanup.
  }
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

async function loadAppSnapshotForApi() {
  try {
    return await appSnapshot();
  } catch {
    return null;
  }
}
