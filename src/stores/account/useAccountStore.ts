import type {
  AccountAuthUser,
  AccountMeResponse,
  BillingUsageResponse,
  LoginResponse,
} from "@/models/interfaces/stores/account/useAccountStore";
export type {
  AccountAuthUser,
  AccountMeResponse,
  BillingUsageResponse,
  LoginResponse,
} from "@/models/interfaces/stores/account/useAccountStore";
import { appSnapshot } from "@/stores/backend";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";
import { isAndroidBuild, isNativeMobileBuild } from "@/platform/buildTarget";
import {
  clearAccountAuthToken,
  readAccountSessionGeneration,
  readAccountAuthToken,
  saveAccountAuthToken,
} from "./useAuthTokenStore";
import type { SavedAccountSession } from "@/models/interfaces/stores/account/useAuthTokenStore";
import { analytics } from "@/analytics/client";

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>("POST", path, body);
}

async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>("GET", path);
}

async function requestJson<T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  const accountGeneration = readAccountSessionGeneration();
  const apiBase = await resolveAccountApiBase();
  assertAccountGeneration(accountGeneration);
  const url = `${apiBase}${path}`;
  try {
    const token = shouldAttachAuthToken(path) ? await readAccountAuthToken() : null;
    assertAccountGeneration(accountGeneration);
    const headers = requestHeaders(body, token);
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
    });
    assertAccountGeneration(accountGeneration);
    const result = await parseResponse<T>(response, method, path, url);
    assertAccountGeneration(accountGeneration);
    return result;
  } catch (error) {
    if (error instanceof AccountApiError || error instanceof AccountSessionChangedError)
      throw error;
    const message = apiBase
      ? `Could not reach Misty server at ${apiBase}. ${errorMessage(error)}`
      : `Missing Misty API base URL for ${method} ${path}.`;
    recordAccountApiDebugEvent({
      level: "error",
      scope: "account-api",
      message,
      detail: `${method} ${url}`,
    });
    throw new Error(message);
  }
}

function assertAccountGeneration(expected: number): void {
  if (readAccountSessionGeneration() !== expected) {
    throw new AccountSessionChangedError();
  }
}

async function parseResponse<T>(
  response: Response,
  method: string,
  path: string,
  url: string,
): Promise<T> {
  const payload = await parsePayload(response, method, path);

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload.trim()
        : responseMessage(payload) || responseError(payload);
    const requestUrl = response.url || url;
    const fallback = `${method} ${requestUrl} failed: ${response.status} ${response.statusText || "HTTP error"}`;
    const errorMessage = message || fallback;
    recordAccountApiDebugEvent({
      level: "error",
      scope: "account-api",
      message: errorMessage,
      detail: `${fallback}\n${payloadDetail(payload)}`,
    });
    throw new AccountApiError(errorMessage, response.status);
  }

  return payload as T;
}

function recordAccountApiDebugEvent(event: {
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
  detail?: string;
}): void {
  if (!accountDebugEnabled()) return;
  void import("@/platform/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent(event);
  });
}

function accountDebugEnabled(): boolean {
  return !isNativeMobileBuild && (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1");
}

async function parsePayload(response: Response, method: string, path: string): Promise<unknown> {
  const text = await response.text();
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return text;
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const firstJsonValue = firstJsonValueText(text);
    if (firstJsonValue) return JSON.parse(firstJsonValue);
    throw new AccountApiError(
      `Misty server returned malformed JSON for ${method} ${path}: ${textPreview(text)}${error instanceof Error ? ` (${error.message})` : ""}`,
      response.status,
    );
  }
}

function textPreview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160) || "empty response";
}

function firstJsonValueText(value: string): string | null {
  const start = value.search(/[\[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

function responseMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function responseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" ? error : "";
}

export async function accountSignIn(email: string, password: string): Promise<AccountAuthUser> {
  const data = await postJson<LoginResponse>("/login", { email, password });
  const id = data.user_id ?? data.id;
  if (!id) {
    throw new AccountApiError("Sign-in response did not include a user id.");
  }
  const user = {
    id,
    name: data.name,
    username: data.username,
    email: data.email,
  };
  if (data.token) {
    await saveAccountAuthToken(data.token, user);
  }
  return user;
}

export async function accountRegister(
  name: string,
  username: string,
  email: string,
  password: string,
): Promise<AccountAuthUser> {
  const data = await postJson<LoginResponse>("/register", { name, username, email, password });
  const id = data.user_id ?? data.id;
  if (!id) {
    throw new AccountApiError("Registration response did not include a user id.");
  }
  const user = {
    id,
    name: data.name,
    username: data.username,
    email: data.email,
  };
  if (data.token) {
    await saveAccountAuthToken(data.token, user);
  }
  return user;
}

export function accountFetchMe(): Promise<AccountMeResponse> {
  return getJson("/me");
}

export function accountFetchBillingUsage(): Promise<BillingUsageResponse> {
  return getJson("/billing/usage");
}

export function accountCreateCheckout(
  tier: "pro" | "max",
  interval: "month" | "year",
): Promise<{ url: string }> {
  return postJson("/billing/checkout-session", { tier, interval });
}

export function accountCreateCreditCheckout(
  packId: "credits_1500" | "credits_3500",
): Promise<{ url: string }> {
  return postJson("/billing/credit-checkout-session", { pack_id: packId });
}

export function accountCreatePortalSession(): Promise<{ url: string }> {
  return postJson("/billing/portal-session");
}

export async function accountUpdateProfile(name: string): Promise<void> {
  await requestJson("PUT", "/me/profile", { name });
}

export async function accountUpdateDevice(device: string): Promise<void> {
  await requestJson("PUT", "/me/device", { device });
}

export async function accountUpdateTelemetryPreferences(
  analyticsEnabled: boolean,
  errorReportingEnabled: boolean,
): Promise<void> {
  await requestJson("PUT", "/me/telemetry", {
    analytics_enabled: analyticsEnabled,
    error_reporting_enabled: errorReportingEnabled,
  });
}

export async function accountLogout(): Promise<SavedAccountSession | null> {
  await accountRevokeCurrentSession();
  return await clearAccountAuthToken();
}

export async function accountRevokeCurrentSession(): Promise<void> {
  try {
    await postJson("/logout");
  } catch {
    // Local sign-out and account switching must still work while offline.
  }
}

class AccountApiError extends Error {
  name = "AccountApiError";

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

class AccountSessionChangedError extends Error {
  name = "AccountSessionChangedError";

  constructor() {
    super("The active Misty account changed before this request finished. Please try again.");
  }
}

export function isAccountUnauthorizedError(error: unknown): boolean {
  return error instanceof AccountApiError && error.status === 401;
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
  const publicApiBase = normalizeApiBaseUrl(import.meta.env.VITE_MISTY_PUBLIC_API_URL);
  const explicitServerUrl = normalizeApiBaseUrl(import.meta.env.VITE_MISTY_SERVER_URL);
  const envApiBase = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE);
  const nativeServerUrl = normalizeApiBaseUrl(
    (await loadAppSnapshotForAccountApi())?.environment.serverUrl,
  );
  return withDefaultApiPath(publicApiBase ?? explicitServerUrl ?? envApiBase ?? nativeServerUrl);
}

async function loadAppSnapshotForAccountApi() {
  try {
    return await appSnapshot();
  } catch {
    return null;
  }
}

function requestHeaders(body: unknown, token: string | null): Headers | undefined {
  if (body === undefined && !token) return undefined;

  const headers = new Headers();
  headers.set("X-Misty-Platform", accountClientPlatform());
  headers.set(
    "X-Misty-Release-Channel",
    import.meta.env.VITE_RELEASE_CHANNEL?.trim() ||
      (import.meta.env.DEV ? "development" : "production"),
  );
  headers.set("X-Misty-Analytics-Enabled", String(analytics.isAnalyticsEnabled()));
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function accountClientPlatform(): "windows" | "macos" | "linux" | "android" | "ios" {
  if (isAndroidBuild) return "android";
  if (isNativeMobileBuild) return "ios";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
}

function shouldAttachAuthToken(path: string): boolean {
  return path !== "/login" && path !== "/register";
}
