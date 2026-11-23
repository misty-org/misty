import { cachedRequest } from "@/api/cache/cached_request";
import { otherServerFetch } from "@/api/client/cookie_session";
import { httpRequest } from "@/api/client/http";
import {
  notifyApiSessionInvalid,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { resolveApiBase } from "@/api/deployment/api";
import { desktopOs } from "@/shared/platform/desktop_os";
import { addRequestCorrelation } from "@/shared/platform/request_correlation";
import type {
  AccountMeResponse,
  LoginResponse,
  ServerAlert,
  SetupKeyResponse,
} from "./account_types";
import {
  AccountApiError,
  errorMessage,
  parseResponse,
  recordAccountApiDebugEvent,
} from "./responses";

export { AccountApiError, isAccountUnauthorizedError } from "./responses";
type AccountMethod = "GET" | "POST" | "PUT";
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
  confirmationStatus: (email: string, password: string) =>
    requestJson<{ status: "confirm_email" | "confirmed" }>("POST", "/login", {
      email,
      password,
      waiting: true,
    }),
  register: (body: unknown) =>
    requestJson<LoginResponse | { status: "confirm_email" }>("POST", "/register", body),
  redeemSetupKey: (setupKey: string) =>
    requestJson<SetupKeyResponse>("POST", "/setup-keys/redeem", { setup_key: setupKey }),
  redeemSetupKeyOn: async (apiBase: string, setupKey: string) => {
    const path = "/setup-keys/redeem";
    const url = `${apiBase}${path}`;
    const body = { setup_key: setupKey };
    const response = await otherServerFetch(url, {
      method: "POST",
      headers: addRequestCorrelation(requestHeaders(body, null) ?? new Headers()),
      body: JSON.stringify(body),
    });
    return parseResponse<SetupKeyResponse>(response, "POST", path, url);
  },
  changePassword: (currentPassword: string, newPassword: string, resetToken?: string) =>
    requestJson<{ status: string }>("PUT", "/me/password", {
      current_password: currentPassword,
      new_password: newPassword,
      ...(resetToken ? { reset_token: resetToken } : {}),
    }),
  serverAlerts: () => requestJson<{ alerts: ServerAlert[] }>("GET", "/server/alerts"),
  logout: () =>
    requestJson<{
      status?: string;
    }>("POST", "/logout"),
  me: () => requestJson<AccountMeResponse>("GET", "/me"),
  meCached: (onCached: (me: AccountMeResponse) => void) =>
    cachedRequest<AccountMeResponse>("/me", {
      onCached,
      init: { headers: clientHeaders() },
    }),
  updateUsername: (username: string) =>
    requestJson<{ username: string }>("PUT", "/me/username", { username }),
  avatar: async () => {
    const response = await accountAvatarRequest("GET");
    return response.blob();
  },
  uploadAvatar: async (png: Blob) => {
    const response = await accountAvatarRequest("PUT", png);
    return (await response.json()) as { avatar_version: number };
  },
  removeAvatar: async () => {
    const response = await accountAvatarRequest("DELETE");
    return (await response.json()) as { avatar_version: number };
  },
  banner: async () => {
    const response = await accountAvatarRequest("GET", undefined, "/me/banner");
    return response.blob();
  },
  uploadBanner: async (png: Blob) => {
    const response = await accountAvatarRequest("PUT", png, "/me/banner");
    return (await response.json()) as { banner_version: number };
  },
  removeBanner: async () => {
    const response = await accountAvatarRequest("DELETE", undefined, "/me/banner");
    return (await response.json()) as { banner_version: number };
  },
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
async function accountAvatarRequest(
  method: "GET" | "PUT" | "DELETE",
  png?: Blob,
  path: "/me/avatar" | "/me/banner" = "/me/avatar",
): Promise<Response> {
  const accountGeneration = readApiSessionGeneration();
  const apiBase = await resolveRequiredAccountApiBase();
  assertAccountGeneration(accountGeneration);
  const token = await readApiAuthToken();
  assertAccountGeneration(accountGeneration);
  const headers = addRequestCorrelation(requestHeaders(undefined, token) ?? new Headers());
  if (png) headers.set("Content-Type", "image/png");
  const response = await httpRequest(`${apiBase}${path}`, {
    method,
    headers,
    body: png,
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
function clientHeaders(): Headers {
  const headers = new Headers();
  headers.set("X-Misty-Platform", desktopOs());
  headers.set(
    "X-Misty-Release-Channel",
    import.meta.env.VITE_RELEASE_CHANNEL?.trim() ||
      (import.meta.env.DEV ? "development" : "production"),
  );
  return headers;
}
function requestHeaders(body: unknown, token: string | null): Headers | undefined {
  if (body === undefined && !token) return undefined;
  const headers = clientHeaders();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
function shouldAttachAuthToken(path: string): boolean {
  return ![
    "/login",
    "/register",
    "/setup-keys/redeem",
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
