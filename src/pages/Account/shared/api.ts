import { appSnapshot } from "../../../api/misty";
import { isAndroidBuild, isNativeMobileBuild } from "../../../platform/buildTarget";
import {
  clearAccountAuthToken,
  readAccountAuthToken,
  saveAccountAuthToken,
  type SavedAccountSession,
} from "./authTokenStore";
import { analytics } from "../../../analytics/client";

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
	  tier: "basic" | "pro" | "max";
  status: "active" | "trialing" | "cancelled" | "expired";
  allows_use: boolean;
  expires_at: string | null;
  trial_started_at: string | null;
	  license_device: string;
	  billing?: {
	    kind: "free" | "trial" | "lifetime" | "subscription";
	    interval: "month" | "year" | null;
	    subscription_status: string | null;
	    current_period_end: string | null;
	    cancel_at_period_end: boolean;
	    customer_portal_available: boolean;
	  };
}

export interface BillingUsageResponse {
	plan: "basic" | "pro" | "max";
	monthly_allowance: number;
	monthly_remaining: number;
	purchased_remaining: number;
	available_credits: number;
	reserved_credits: number;
	next_reset_at: string;
	usage_by_meter: Array<{ meter: string; credits: number }> | null;
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

async function requestJson<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
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
    recordAccountApiDebugEvent({
      level: "error",
      scope: "account-api",
      message,
      detail: `${method} ${url}`,
    });
    throw new Error(message);
  }
}

async function parseResponse<T>(response: Response, method: string, path: string, url: string): Promise<T> {
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
  void import("../../../shared/debug/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent(event);
  });
}

function accountDebugEnabled(): boolean {
  return !isNativeMobileBuild &&
    (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1");
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
    throw new AccountApiError(`Misty server returned malformed JSON for ${method} ${path}: ${textPreview(text)}${error instanceof Error ? ` (${error.message})` : ""}`, response.status);
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
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
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
    email: data.email,
  };
  if (data.token) {
    await saveAccountAuthToken(data.token, user);
  }
  return user;
}

export async function accountRegister(name: string, email: string, password: string): Promise<AccountAuthUser> {
  const data = await postJson<LoginResponse>("/register", { name, email, password });
  const id = data.user_id ?? data.id;
  if (!id) {
    throw new AccountApiError("Registration response did not include a user id.");
  }
  const user = {
    id,
    name: data.name,
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

export function accountCreateCheckout(tier: "pro" | "max", interval: "month" | "year"): Promise<{ url: string }> {
	return postJson("/billing/checkout-session", { tier, interval });
}

export function accountCreateCreditCheckout(packId: "credits_1500" | "credits_3500"): Promise<{ url: string }> {
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

export async function accountUpdateTelemetryPreferences(analyticsEnabled: boolean, errorReportingEnabled: boolean): Promise<void> {
  await requestJson("PUT", "/me/telemetry", {
    analytics_enabled: analyticsEnabled,
    error_reporting_enabled: errorReportingEnabled,
  });
}

export async function accountLogout(): Promise<SavedAccountSession | null> {
  try {
    await postJson("/logout");
  } catch {
    // Local sign-out and account switching must still work while offline.
  }
  return await clearAccountAuthToken();
}

class AccountApiError extends Error {
  name = "AccountApiError";

  constructor(message: string, readonly status?: number) {
    super(message);
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
  headers.set("X-Misty-Platform", accountClientPlatform());
  headers.set("X-Misty-Release-Channel", import.meta.env.VITE_RELEASE_CHANNEL?.trim() || (import.meta.env.DEV ? "development" : "production"));
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
