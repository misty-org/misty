import { recordClientDebugEvent } from "../../../shared/debug/clientDebug";
import { appSnapshot } from "../../../api/misty";
import {
  clearAccountAuthToken,
  readAccountAuthToken,
  saveAccountAuthToken,
} from "./authTokenStore";

export interface AccountAuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AccountMeResponse {
  id: string;
  name: string;
  email: string;
  created_at: string;
  tier: "basic" | "personal" | "pro";
  status: "active" | "trialing" | "cancelled" | "expired";
  allows_use: boolean;
  expires_at: string | null;
  trial_started_at: string | null;
  license_device: string;
}

interface LoginResponse {
  id?: string;
  user_id?: string;
  token?: string;
  name: string;
  email: string;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>("POST", path, body);
}

async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>("GET", path);
}

async function requestJson<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const apiBase = await resolveAccountApiBase();
  const url = `${apiBase}${path}`;
  try {
    const token = shouldAttachAuthToken(path) ? await readAccountAuthToken() : null;
    const headers = requestHeaders(body, token);
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
    });
    return await parseResponse<T>(response, method, path, url);
  } catch (error) {
    if (error instanceof AccountApiError) throw error;
    const message = apiBase
      ? `Could not reach Misty server at ${apiBase}. ${errorMessage(error)}`
      : `Missing VITE_API_BASE for ${method} ${path}.`;
    recordClientDebugEvent({
      level: "error",
      scope: "account-api",
      message,
      detail: `${method} ${url}`,
    });
    throw new Error(message);
  }
}

async function parseResponse<T>(response: Response, method: string, path: string, url: string): Promise<T> {
  const contentType = response.headers.get("Content-Type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload.trim()
        : typeof payload?.message === "string"
          ? payload.message
          : typeof payload?.error === "string"
            ? payload.error
            : "";
    const requestUrl = response.url || url;
    const fallback = `${method} ${requestUrl} failed: ${response.status} ${response.statusText || "HTTP error"}`;
    const errorMessage = message || fallback;
    recordClientDebugEvent({
      level: "error",
      scope: "account-api",
      message: errorMessage,
      detail: `${fallback}\n${payloadDetail(payload)}`,
    });
    throw new AccountApiError(errorMessage, response.status);
  }

  return payload as T;
}

export async function accountSignIn(email: string, password: string): Promise<AccountAuthUser> {
  const data = await postJson<LoginResponse>("/login", { email, password });
  const id = data.user_id ?? data.id;
  if (!id) {
    throw new AccountApiError("Sign-in response did not include a user id.");
  }
  if (data.token) {
    await saveAccountAuthToken(data.token);
  }
  return {
    id,
    name: data.name,
    email: data.email,
  };
}

export async function accountRegister(name: string, email: string, password: string): Promise<AccountAuthUser> {
  const data = await postJson<LoginResponse>("/register", { name, email, password });
  const id = data.user_id ?? data.id;
  if (!id) {
    throw new AccountApiError("Registration response did not include a user id.");
  }
  if (data.token) {
    await saveAccountAuthToken(data.token);
  }
  return {
    id,
    name: data.name,
    email: data.email,
  };
}

export function accountFetchMe(): Promise<AccountMeResponse> {
  return getJson("/me");
}

export async function accountLogout(): Promise<void> {
  try {
    await postJson("/logout");
  } finally {
    await clearAccountAuthToken();
  }
}

class AccountApiError extends Error {
  name = "AccountApiError";

  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Network request failed.";
}

function payloadDetail(payload: unknown): string {
  if (typeof payload === "string") return payload.slice(0, 800);
  try {
    return JSON.stringify(payload, null, 2).slice(0, 800);
  } catch {
    return "";
  }
}

async function resolveAccountApiBase(): Promise<string> {
  const explicitServerUrl = normalizeBaseUrl(import.meta.env.VITE_MISTY_SERVER_URL);
  const envApiBase = normalizeBaseUrl(import.meta.env.VITE_API_BASE);
  const nativeServerUrl = normalizeBaseUrl((await loadAppSnapshotForAccountApi())?.environment.serverUrl);
  const base = explicitServerUrl ?? envApiBase ?? nativeServerUrl;
  return withApiPath(base);
}

async function loadAppSnapshotForAccountApi() {
  try {
    return await appSnapshot();
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
}

function withApiPath(base: string | null): string {
  if (!base) return "";
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

function requestHeaders(body: unknown, token: string | null): Headers | undefined {
  if (body === undefined && !token) return undefined;

  const headers = new Headers();
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function shouldAttachAuthToken(path: string): boolean {
  return path !== "/login" && path !== "/register";
}
