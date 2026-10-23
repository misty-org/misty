import { httpRequest } from "@/api/client/http";
import {
  notifyApiSessionInvalid,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { resolveApiBase } from "@/api/deployment/api";
import { desktopOs } from "@/shared/platform/desktopOs";
import { addRequestCorrelation } from "@/shared/platform/requestCorrelation";
import type { AccountHandoffPath, AccountMeResponse, LoginResponse } from "./types";
import {
  AccountApiError,
  errorMessage,
  parseResponse,
  recordAccountApiDebugEvent,
} from "./responses";

export { AccountApiError, isAccountUnauthorizedError } from "./responses";
type AccountMethod = "GET" | "POST" | "PUT";
let readAnalyticsEnabled = () => false;
export function configureAccountApi(context: { readAnalyticsEnabled: () => boolean }): void {
  readAnalyticsEnabled = context.readAnalyticsEnabled;
}
export const accountApi = {
  googleAvailable: () => requestJson<{ enabled: boolean }>("GET", "/auth/google"),
  beginGoogle: (reauthenticate = false, signal?: AbortSignal) =>
    requestJson<{ url: string; flow_token: string; expires_in: number }>(
      "POST",
      "/auth/google",
      { reauthenticate },
      signal,
    ),
  completeGoogle: (flowToken: string, signal?: AbortSignal, completionCode?: string) =>
    requestJson<
      LoginResponse | { status: "pending" | "confirm" } | { reauthentication_token: string }
    >(
      "POST",
      "/auth/google/complete",
      completionCode
        ? { flow_token: flowToken, completion_code: completionCode }
        : { flow_token: flowToken },
      signal,
    ),
  signIn: (email: string, password: string) =>
    requestJson<LoginResponse>("POST", "/login", {
      email,
      password,
    }),
  register: (body: unknown) => requestJson<LoginResponse>("POST", "/register", body),
  logout: () =>
    requestJson<{
      status?: string;
    }>("POST", "/logout"),
  forgotPassword: (email: string) =>
    requestJson<{
      message?: string;
    }>("POST", "/auth/forgot", {
      email,
    }),
  me: () => requestJson<AccountMeResponse>("GET", "/me"),
  handoff: (path?: AccountHandoffPath) =>
    requestJson<{
      url: string;
    }>(
      "POST",
      "/auth/handoff",
      path
        ? {
            path,
          }
        : {},
    ),
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
async function requestJson<T>(
  method: AccountMethod,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const accountGeneration = readApiSessionGeneration();
  const apiBase = await resolveRequiredAccountApiBase();
  assertAccountGeneration(accountGeneration);
  const url = `${apiBase}${path}`;
  try {
    const token = shouldAttachAuthToken(path) ? await readApiAuthToken() : null;
    assertAccountGeneration(accountGeneration);
    const headers = addRequestCorrelation(requestHeaders(body, token) ?? new Headers());
    const response = await httpRequest(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
      signal,
    });
    assertAccountGeneration(accountGeneration);
    if (response.status === 401 && shouldAttachAuthToken(path) && !token) {
      notifyApiSessionInvalid();
    }
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
function assertAccountGeneration(expected: number): void {
  if (readApiSessionGeneration() !== expected) throw new AccountSessionChangedError();
}
function requestHeaders(body: unknown, token: string | null): Headers | undefined {
  if (body === undefined && !token) return undefined;
  const headers = new Headers();
  headers.set("X-Misty-Platform", desktopOs());
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
function shouldAttachAuthToken(path: string): boolean {
  return ![
    "/login",
    "/register",
    "/auth/forgot",
    "/auth/google",
    "/auth/google/complete",
    "/logout",
  ].includes(path);
}
async function resolveRequiredAccountApiBase(): Promise<string> {
  const base = await resolveApiBase();
  if (!base) throw new Error("Misty server URL is not configured.");
  return base;
}
class AccountSessionChangedError extends Error {
  name = "AccountSessionChangedError";
  constructor() {
    super("The active Misty account changed before this request finished. Please try again.");
  }
}
