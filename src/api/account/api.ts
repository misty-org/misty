import { resolveApiBase } from "@/api/deployment/api";
import { httpRequest } from "@/api/client/http";
import { readApiAuthToken, readApiSessionGeneration } from "@/api/client/session";
import { attachSelfHostEntitlementProof } from "@/api/self-host/proof";
import { isAndroidBuild, isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { addRequestCorrelation } from "@/shared/platform/requestCorrelation";
import type { AccountHandoffPath, AccountMeResponse, LoginResponse } from "./types";

type AccountMethod = "GET" | "POST" | "PUT";
let readAnalyticsEnabled = () => false;

export function configureAccountApi(context: { readAnalyticsEnabled: () => boolean }): void {
  readAnalyticsEnabled = context.readAnalyticsEnabled;
}

export const accountApi = {
  signIn: (email: string, password: string) =>
    requestJson<LoginResponse>("POST", "/login", { email, password }),
  register: (path: "/register" | "/self-host/bootstrap" | "/self-host/enroll", body: unknown) =>
    requestJson<LoginResponse>("POST", path, body),
  me: () => requestJson<AccountMeResponse>("GET", "/me"),
  handoff: (path?: AccountHandoffPath) =>
    requestJson<{ url: string }>("POST", "/auth/handoff", path ? { path } : {}),
  avatar: async () => {
    const response = await accountAvatarRequest();
    return response.blob();
  },
  updateTelemetry: (analyticsEnabled: boolean, errorReportingEnabled: boolean) =>
    requestJson<void>("PUT", "/me/telemetry", {
      analytics_enabled: analyticsEnabled,
      error_reporting_enabled: errorReportingEnabled,
    }),
  resolveBase: resolveApiBase,
};

async function requestJson<T>(method: AccountMethod, path: string, body?: unknown): Promise<T> {
  const accountGeneration = readApiSessionGeneration();
  const apiBase = await resolveRequiredAccountApiBase();
  assertAccountGeneration(accountGeneration);
  const url = `${apiBase}${path}`;

  try {
    const token = shouldAttachAuthToken(path) ? await readApiAuthToken() : null;
    assertAccountGeneration(accountGeneration);
    const headers = addRequestCorrelation(requestHeaders(body, token) ?? new Headers());
    if (path === "/login" || path.startsWith("/self-host/")) {
      await attachSelfHostEntitlementProof(headers);
    }
    const response = await httpRequest(url, {
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

async function accountAvatarRequest(): Promise<Response> {
  const accountGeneration = readApiSessionGeneration();
  const apiBase = await resolveRequiredAccountApiBase();
  assertAccountGeneration(accountGeneration);
  const token = await readApiAuthToken();
  assertAccountGeneration(accountGeneration);
  const headers = addRequestCorrelation(requestHeaders(undefined, token) ?? new Headers());
  const response = await httpRequest(`${apiBase}/me/avatar`, {
    method: "GET",
    headers,
    credentials: "include",
  });
  assertAccountGeneration(accountGeneration);
  if (!response.ok) {
    const message = (await response.text()).trim();
    assertAccountGeneration(accountGeneration);
    throw new AccountApiError(
      message || `Profile image request failed (${response.status}).`,
      response.status,
    );
  }
  return response;
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

function assertAccountGeneration(expected: number): void {
  if (readApiSessionGeneration() !== expected) throw new AccountSessionChangedError();
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
  headers.set("X-Misty-Analytics-Enabled", String(readAnalyticsEnabled()));
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
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

function recordAccountApiDebugEvent(event: {
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
  detail?: string;
}): void {
  if (isNativeMobileBuild || (!import.meta.env.DEV && import.meta.env.VITE_MISTY_DEBUG !== "1")) {
    return;
  }
  void import("@/shared/platform/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent(event);
  });
}

function textPreview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160) || "empty response";
}

function firstJsonValueText(value: string): string | null {
  const start = value.search(/[[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
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

async function resolveRequiredAccountApiBase(): Promise<string> {
  const base = await resolveApiBase();
  if (!base) throw new Error("Misty server URL is not configured.");
  return base;
}

export class AccountApiError extends Error {
  name = "AccountApiError";

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class AccountSessionChangedError extends Error {
  name = "AccountSessionChangedError";

  constructor() {
    super("The active Misty account changed before this request finished. Please try again.");
  }
}

export function isAccountUnauthorizedError(error: unknown): boolean {
  return error instanceof AccountApiError && error.status === 401;
}
