import type { AccountRequestInit } from "./native-account-fetch";
import { cookieSessionFetch } from "./cookie-session";
import { rateLimitResponse, recordRateLimit } from "./rateLimit";
const TRANSIENT_NETWORK_PATTERNS = [
  "load failed",
  "failed to fetch",
  "networkerror",
  "network request failed",
  "connection was lost",
];

export function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return TRANSIENT_NETWORK_PATTERNS.some((pattern) => msg.includes(pattern));
}

export function isAbortError(error: unknown): boolean {
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

// After a request exhausts its retries against an unavailable server, later
// requests make a single attempt until one succeeds or the cooling period ends.
// Without this, every caller's own retry loop multiplies these retries during
// an outage or a deploy.
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

    try {
      const coolingDown = rateLimitResponse(input, init);
      if (coolingDown) return coolingDown;
      const response = await cookieSessionFetch(input, init);
      recordRateLimit(input, init, response);
      if ([502, 503, 504].includes(response.status)) {
        const waitMs = retryAfterMs(response);
        // A server asking for more than a short pause is not retried here.
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
      lastError = error;
      if (isAbortError(error) || init.signal?.aborted) {
        const abortErr = error instanceof Error ? error : new Error("Request was aborted");
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

/** Exponential backoff with equal jitter (half fixed, half random), so clients
 * that failed together do not retry together. */
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
    const timer = setTimeout(resolve, delay);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        const abortErr = new Error("Request was aborted");
        abortErr.name = "AbortError";
        reject(abortErr);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function httpBlob(input: RequestInfo | URL, init?: RequestInit): Promise<Blob> {
  const response = await httpRequest(input, init);
  if (!response.ok) {
    throw new HttpStatusError(input.toString(), response.status, response.statusText);
  }
  return response.blob();
}

/** How long other transports (event stream, Space socket) should still wait
 * before reconnecting to a server this client found unavailable. */
export function httpOutageRemainingMs(): number {
  return Math.max(0, outageUntil - Date.now());
}

/** Clears outage memory, for tests. */
export function resetHttpOutageForTests(): void {
  noteAvailable();
}

export class HttpRequestError extends Error {
  constructor(url: string, cause: unknown) {
    super(`Could not reach ${url}: ${errorText(cause)}`);
    this.name = "HttpRequestError";
  }
}

export class HttpStatusError extends Error {
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
