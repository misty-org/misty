import type { AccountRequestInit } from "./native_account_fetch";
import { abortAny } from "./abort_any";
import { cookieSessionFetch } from "./cookie_session";
import { rateLimitResponse, recordRateLimit } from "./rate_limit";
const TRANSIENT_NETWORK_PATTERNS = [
  "load failed",
  "failed to fetch",
  "networkerror",
  "network request failed",
  "connection was lost",
];

function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return TRANSIENT_NETWORK_PATTERNS.some((pattern) => msg.includes(pattern));
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: unknown }).name === "AbortError"
  ) {
    return true;
  }
  return false;
}

const idempotentAnswerTimeoutMs = 30_000;

class RequestTimeoutError extends Error {
  constructor() {
    super("The server took too long to answer.");
    this.name = "RequestTimeoutError";
  }
}

function boundedAttempt(
  init: AccountRequestInit,
  bounded: boolean,
): { init: AccountRequestInit; answered(): void; timedOut(): boolean } {
  if (!bounded) return { init, answered: () => {}, timedOut: () => false };
  const controller = new AbortController();
  let expired = false;
  const caller = init.signal;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, idempotentAnswerTimeoutMs);
  const combined = abortAny(caller ? [caller, controller.signal] : [controller.signal]);
  return {
    init: { ...init, signal: combined.signal },
    answered: () => {
      clearTimeout(timer);
      combined.dispose();
    },
    timedOut: () => expired,
  };
}

let outageUntil = 0;
let outageStreak = 0;

function noteOutage(retryAfterMs = 0) {
  outageStreak = Math.min(outageStreak + 1, 6);
  const cooling = Math.max(retryAfterMs, 1_000 * 2 ** (outageStreak - 1));
  outageUntil = Date.now() + Math.min(60_000, cooling);
}

function noteAvailable() {
  outageStreak = 0;
  outageUntil = 0;
}

function retryAfterMs(response: Response): number {
  const value = response.headers.get("Retry-After");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

export async function httpRequest(
  input: RequestInfo | URL,
  init: AccountRequestInit = {},
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const maxAttempts = isIdempotent && Date.now() >= outageUntil ? 3 : 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (init.signal?.aborted) {
      const abortErr = new Error("Request was aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    const attemptInit = boundedAttempt(init, isIdempotent);
    try {
      const coolingDown = rateLimitResponse(input, init);
      if (coolingDown) {
        attemptInit.answered();
        return coolingDown;
      }
      const response = await cookieSessionFetch(input, attemptInit.init);
      attemptInit.answered();
      recordRateLimit(input, init, response);
      const answered =
        response.status === 503 &&
        (response.headers.get("Content-Type") ?? "").includes("application/json");
      if ([502, 503, 504].includes(response.status) && !answered) {
        const waitMs = retryAfterMs(response);
        if (isIdempotent && attempt < maxAttempts && waitMs <= 2_000 && !init.signal?.aborted) {
          await response.body?.cancel();
          await backoffDelay(attempt, init.signal, waitMs);
          continue;
        }
        noteOutage(waitMs);
        return response;
      }
      noteAvailable();
      return response;
    } catch (error) {
      attemptInit.answered();
      if (attemptInit.timedOut() && !init.signal?.aborted) {
        lastError = new RequestTimeoutError();
        break;
      }
      lastError = error;
      if (isAbortError(error)) throw error;
      if (init.signal?.aborted) {
        const abortErr = new Error(error instanceof Error ? error.message : "Request was aborted", {
          cause: error,
        });
        abortErr.name = "AbortError";
        throw abortErr;
      }

      if (isIdempotent && isTransientNetworkError(error) && attempt < maxAttempts) {
        await backoffDelay(attempt, init.signal);
        continue;
      }
      if (isTransientNetworkError(error)) noteOutage();
      break;
    }
  }

  throw new HttpRequestError(input.toString(), lastError);
}

function backoffDelay(attempt: number, signal?: AbortSignal | null, minimumMs = 0): Promise<void> {
  const cap = Math.min(2_000, 250 * 2 ** (attempt - 1));
  const delay = Math.max(minimumMs, cap / 2 + Math.floor(Math.random() * (cap / 2)));

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortErr = new Error("Request was aborted");
      abortErr.name = "AbortError";
      reject(abortErr);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      const abortErr = new Error("Request was aborted");
      abortErr.name = "AbortError";
      reject(abortErr);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function httpBlob(input: RequestInfo | URL, init?: RequestInit): Promise<Blob> {
  const response = await httpRequest(input, init);
  if (!response.ok) {
    throw new HttpStatusError(input.toString(), response.status, response.statusText);
  }
  return response.blob();
}

export function httpOutageRemainingMs(): number {
  return Math.max(0, outageUntil - Date.now());
}

export class HttpRequestError extends Error {
  constructor(url: string, cause: unknown) {
    super(`Could not reach ${url}: ${errorText(cause)}`);
    this.name = "HttpRequestError";
  }
}

class HttpStatusError extends Error {
  constructor(
    url: string,
    readonly status: number,
    statusText: string,
  ) {
    super(`Request to ${url} failed (${status}${statusText ? ` ${statusText}` : ""}).`);
    this.name = "HttpStatusError";
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resetHttpOutageForTests(): void {
  noteAvailable();
}
