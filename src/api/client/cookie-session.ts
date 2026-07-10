import { nativeAccountFetch } from "./native-account-fetch";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { resolveApiBase, resolveHostedApiBase } from "@/api/deployment/api";
import { isApiSignedOut, readApiSessionGeneration } from "./session";

const refreshes = new Map<string, Promise<boolean>>();
const refreshResults = new Map<string, { generation: number; revision: number; valid: boolean }>();
let refreshRevision = 0;
const sessionLocks = new Map<string, Promise<unknown>>();

async function withSessionLock<T>(base: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return await navigator.locks.request(`misty-session:${base}`, operation);
  }
  const previous = sessionLocks.get(base) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  sessionLocks.set(base, next);
  try {
    return await next;
  } finally {
    if (sessionLocks.get(base) === next) sessionLocks.delete(base);
  }
}

export async function captureAccountCookies(base: string, accountId?: string): Promise<void> {
  await persistAccountCookies(base, accountId);
  refreshResults.delete(base);
}

async function persistAccountCookies(base: string, accountId?: string): Promise<void> {
  if (!hasTauriInternals()) return;
  await invoke("auth_cookie_capture", { apiBase: base, accountId: accountId ?? null });
}

export async function restoreAccountCookies(
  base: string,
  accountId: string | null,
): Promise<boolean> {
  if (!hasTauriInternals()) return true;
  return withSessionLock(base, async () => {
    const restored = await invoke<boolean>("auth_cookie_restore", { apiBase: base, accountId });
    refreshResults.delete(base);
    return restored;
  });
}

export async function forgetAccountCookies(base: string, accountId: string): Promise<void> {
  if (!hasTauriInternals()) return;
  await invoke("auth_cookie_forget", { apiBase: base, accountId });
}

// Refresh is shared by simultaneous requests. Web Locks also serialize browser
// tabs so one tab does not replay a refresh cookie consumed by another tab.
async function refresh(base: string, generation: number, revision: number): Promise<boolean> {
  assertGeneration(generation);
  const key = `${generation}:${base}`;
  const pending = refreshes.get(key);
  if (pending) return pending;
  const run = async () => {
    // An old response must never rotate cookies belonging to a new account.
    assertGeneration(generation);
    const previous = refreshResults.get(base);
    if (previous?.generation === generation && (!previous.valid || previous.revision > revision)) {
      return previous.valid;
    }
    // The lock is shared across tabs, but refreshResults is not. Recheck the
    // current cookies after acquiring it: another tab may already have rotated
    // them while this request's expired response was in flight. A resource's
    // own 401 also does not necessarily mean the account session has expired.
    const current = await accountFetch(`${base}/me`, {
      credentials: "include",
      headers: { "X-Misty-CSRF": "1" },
    });
    await current.body?.cancel();
    assertGeneration(generation);
    if (current.ok) {
      refreshResults.set(base, { generation, revision: ++refreshRevision, valid: true });
      return true;
    }
    if (current.status !== 401) throw new Error("Session validation is temporarily unavailable.");
    const response = await accountFetch(`${base}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Misty-CSRF": "1" },
    });
    await response.body?.cancel();
    assertGeneration(generation);
    if (response.status === 401 || response.status === 403) {
      refreshResults.set(base, { generation, revision: ++refreshRevision, valid: false });
      return false;
    }
    if (!response.ok) throw new Error("Session refresh is temporarily unavailable.");
    await persistAccountCookies(base);
    assertGeneration(generation);
    refreshResults.set(base, { generation, revision: ++refreshRevision, valid: true });
    return true;
  };
  const promise = withSessionLock(base, run).finally(() => refreshes.delete(key));
  refreshes.set(key, promise);
  return promise;
}

function assertGeneration(generation: number): void {
  if (readApiSessionGeneration() !== generation) throw new Error("The active account changed.");
}

// Routes that work without a session, used by sign-in, registration, enrollment
// and password reset while no account is active.
const signedOutPaths = new Set([
  "/login",
  "/register",
  "/self-host/bootstrap",
  "/self-host/enroll",
  "/auth/forgot",
  "/auth/reset",
  "/auth/reset/start",
  "/auth/reset/validate",
  "/instance",
  "/health",
]);

export async function cookieSessionFetch(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const generation = readApiSessionGeneration();
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const bases = [await resolveApiBase(), resolveHostedApiBase()].filter(Boolean);
  const base = bases.find((candidate) => url.startsWith(`${candidate}/`));
  if (!base) return fetch(input, init);
  const headers = new Headers(
    init.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.set("X-Misty-CSRF", "1");
  const options: RequestInit = { credentials: "include", ...init, headers };
  const revision = refreshRevision;
  const path = url.slice(base.length).split("?")[0];
  // A signed-out desktop has an empty cookie jar. Answer account requests
  // locally instead of sending them, and never try to refresh a session.
  const signedOut = isApiSignedOut();
  if (signedOut && !signedOutPaths.has(path)) {
    return new Response(JSON.stringify({ code: "not_authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const changesSession = [
    "/login",
    "/register",
    "/logout",
    "/self-host/enroll",
    "/self-host/bootstrap",
  ].includes(path);
  const send = async () => {
    assertGeneration(generation);
    const response = await accountFetch(input instanceof Request ? input.clone() : input, options);
    if (changesSession && response.ok) refreshResults.delete(base);
    return response;
  };
  const response = await (changesSession ? withSessionLock(base, send) : send());
  if (
    response.status !== 401 ||
    signedOut ||
    headers.has("Authorization") ||
    options.credentials === "omit" ||
    [
      "/login",
      "/register",
      "/logout",
      "/auth/refresh",
      "/self-host/enroll",
      "/self-host/bootstrap",
    ].includes(path)
  )
    return response;
  let refreshed: boolean;
  try {
    refreshed = await refresh(base, generation, revision);
  } catch (error) {
    await response.body?.cancel();
    throw error;
  }
  if (!refreshed) return response;
  // Retrying discards the first body. Release its native stream/HTTP request.
  await response.body?.cancel();
  return send();
}

function accountFetch(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  // Desktop account cookies live in Rust, not the WebView. Login, normal
  // requests, refresh and retries must all use that same cookie jar. Scoped
  // app credentials and explicitly anonymous requests must never inherit it.
  const usesAccountCookies =
    init.credentials !== "omit" && !new Headers(init.headers).has("Authorization");
  return hasTauriInternals() && usesAccountCookies
    ? nativeAccountFetch(input, init)
    : fetch(input, init);
}
