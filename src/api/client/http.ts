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

export async function httpRequest(
  input: RequestInfo | URL,
  init: AccountRequestInit = {},
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const maxAttempts = isIdempotent ? 3 : 1;

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
      if (
        isIdempotent &&
        attempt < maxAttempts &&
        [502, 503, 504].includes(response.status) &&
        !init.signal?.aborted
      ) {
        await response.body?.cancel();
        await backoffDelay(attempt, init.signal);
        continue;
      }
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
      break;
    }
  }

  throw new HttpRequestError(input.toString(), lastError);
}

function backoffDelay(attempt: number, signal?: AbortSignal | null): Promise<void> {
  const base = attempt === 1 ? 150 : 350;
  const jitter = Math.floor(Math.random() * 50);
  const delay = base + jitter;

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
