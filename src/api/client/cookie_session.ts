import { noteAccountResponse } from "./account_limits";
import { nativeAccountFetch } from "./native_account_fetch";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { resolveApiBase, resolveHostedApiBase } from "@/api/deployment/api";
import { isApiSignedOut, readApiSessionGeneration } from "./session";

const refreshes = new Map<string, Promise<boolean>>();
const refreshResults = new Map<string, { generation: number; revision: number; valid: boolean }>();
let refreshRevision = 0;
const sessionLocks = new Map<string, Promise<unknown>>();

let sessionChannel: BroadcastChannel | undefined;
function shareSessionChange(base?: string): void {
  if (
    !sessionChannel &&
    typeof window !== "undefined" &&
    typeof window.BroadcastChannel === "function"
  ) {
    try {
      sessionChannel = new window.BroadcastChannel("misty:cookie-session");
      sessionChannel.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (typeof data === "string") refreshResults.delete(data);
      };
    } catch {}
  }
  if (base) sessionChannel?.postMessage(base);
}
function clearRefreshResult(base: string): void {
  refreshResults.delete(base);
  shareSessionChange(base);
}

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
  clearRefreshResult(base);
}

async function persistAccountCookies(base: string, accountId?: string): Promise<void> {
  if (!hasTauriInternals()) return;
  await invoke("auth_session_capture", { apiBase: base, accountId: accountId ?? null });
}

export async function restoreAccountCookies(
  base: string,
  accountId: string | null,
): Promise<boolean> {
  if (!hasTauriInternals()) return true;
  return withSessionLock(base, async () => {
    const restored = await invoke<boolean>("auth_session_restore", { apiBase: base, accountId });
    clearRefreshResult(base);
    return restored;
  });
}

export async function forgetAccountCookies(base: string, accountId: string): Promise<void> {
  if (!hasTauriInternals()) return;
  await invoke("auth_session_forget", { apiBase: base, accountId });
}

async function refresh(base: string, generation: number, revision: number): Promise<boolean> {
  assertGeneration(generation);
  const key = `${generation}:${base}`;
  const pending = refreshes.get(key);
  if (pending) return pending;
  const run = async () => {
    assertGeneration(generation);
    const previous = refreshResults.get(base);
    if (previous?.generation === generation && (!previous.valid || previous.revision > revision)) {
      return previous.valid;
    }
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
    shareSessionChange(base);
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

const signedOutPaths = new Set([
  "/login",
  "/register",
  "/auth/google",
  "/auth/google/complete",
  "/health",
  "/setup-keys/redeem",
]);

export async function cookieSessionFetch(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  shareSessionChange();
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
  const signedOut = isApiSignedOut();
  if (signedOut && !signedOutPaths.has(path)) {
    return new Response(JSON.stringify({ code: "not_authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const rejected = refreshResults.get(base);
  if (
    rejected?.generation === generation &&
    !rejected.valid &&
    !headers.has("Authorization") &&
    options.credentials !== "omit" &&
    !signedOutPaths.has(path) &&
    path !== "/logout"
  ) {
    assertGeneration(generation);
    return new Response(JSON.stringify({ code: "not_authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const changesSession = ["/auth/google/complete", "/login", "/register", "/logout"].includes(path);
  const send = async () => {
    assertGeneration(generation);
    const response = await accountFetch(input instanceof Request ? input.clone() : input, options);
    if (changesSession && response.ok) clearRefreshResult(base);
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
      "/auth/google",
      "/auth/google/complete",
      "/setup-keys/redeem",
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
  await response.body?.cancel();
  return send();
}

export async function otherServerFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Misty-CSRF", "1");
  return accountFetch(url, { credentials: "include", ...init, headers });
}

async function accountFetch(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const usesAccountCookies =
    init.credentials !== "omit" && !new Headers(init.headers).has("Authorization");
  const response = await (hasTauriInternals() && usesAccountCookies
    ? nativeAccountFetch(input, init)
    : fetch(input, init));
  noteAccountResponse(input, response);
  return response;
}
