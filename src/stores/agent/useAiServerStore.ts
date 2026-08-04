import { appSnapshot } from "@/stores/backend";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";
import { addRequestCorrelation } from "@/platform/requestCorrelation";
import {
  isAccountSessionTransitioning,
  readAccountSessionGeneration,
  readAccountAuthToken,
} from "@/stores/account/useAuthTokenStore";

interface ManagedAiErrorPayload {
  code?: string;
  message?: string;
  reset_at?: string;
  retry_after_seconds?: number;
}

export class ManagedAiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ManagedAiRequestError";
  }
}

export async function managedAiRequest<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const accountGeneration = readAccountSessionGeneration();
  assertStableManagedAiAccount(accountGeneration);
  const base = await resolveServerApiBase();
  assertStableManagedAiAccount(accountGeneration);
  if (!base) throw new Error("Misty server URL is not configured.");
  const token = await readAccountAuthToken();
  assertStableManagedAiAccount(accountGeneration);
  const headers = new Headers(init?.headers);
  addRequestCorrelation(headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      credentials: "include",
      ...init,
      headers,
    });
  } catch (error) {
    assertStableManagedAiAccount(accountGeneration);
    throw error;
  }
  assertStableManagedAiAccount(accountGeneration);
  if (!response.ok) {
    const text = await response.text();
    assertStableManagedAiAccount(accountGeneration);
    let payload: ManagedAiErrorPayload | null = null;
    try {
      payload = JSON.parse(text) as ManagedAiErrorPayload;
    } catch {
      // Plain-text errors are handled below.
    }
    if (payload) {
      if (payload.code === "hosted_ai_limit_reached") {
        const reset = payload.reset_at ? new Date(payload.reset_at).toLocaleDateString() : "Monday";
        throw new ManagedAiRequestError(
          // Upgrading happens on the website; the desktop app cannot take a
          // payment, so point at the reset rather than a dead-end CTA.
          `Weekly hosted AI usage is fully used. Try again after the reset on ${reset}, or upgrade to Pro from Account settings.`,
          response.status,
          payload.code,
        );
      }
      if (payload.code === "rate_limited") {
        const retryAfter = payload.retry_after_seconds ?? retryAfterHeader(response);
        const retryPolicy = path.includes("/media-search/")
          ? ""
          : " Requests are never retried automatically.";
        throw new ManagedAiRequestError(
          `Agent request limit reached. Try again in ${retryAfter} seconds.${retryPolicy}`,
          response.status,
          payload.code,
          retryAfter,
        );
      }
      if (payload.code === "request_canceled") {
        throw new ManagedAiRequestError("Agent request canceled.", response.status, payload.code);
      }
      if (payload.message?.trim())
        throw new ManagedAiRequestError(
          payload.message.trim(),
          response.status,
          payload.code,
          payload.retry_after_seconds ?? retryAfterHeader(response),
        );
    }
    throw new ManagedAiRequestError(
      text.trim() || `Agent ${path} failed: ${response.status}`,
      response.status,
      undefined,
      retryAfterHeader(response),
    );
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return undefined as T;
  const result = (await response.json()) as T;
  assertStableManagedAiAccount(accountGeneration);
  return result;
}

function assertStableManagedAiAccount(generation: number): void {
  if (isAccountSessionTransitioning() || generation !== readAccountSessionGeneration()) {
    throw new ManagedAiRequestError(
      "Wait for the account switch to finish.",
      409,
      "account_changed",
    );
  }
}

function retryAfterHeader(response: Response): number | undefined {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

async function resolveServerApiBase(): Promise<string> {
  const publicApiBase = normalizeApiBaseUrl(import.meta.env.VITE_MISTY_PUBLIC_API_URL);
  const explicitServerUrl = normalizeApiBaseUrl(import.meta.env.VITE_MISTY_SERVER_URL);
  const envApiBase = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE);
  const nativeServerUrl = normalizeApiBaseUrl((await loadAppSnapshot())?.environment.serverUrl);
  const localBetaServerUrl = import.meta.env.DEV ? "http://localhost:8080/api" : null;
  return withDefaultApiPath(
    publicApiBase ?? explicitServerUrl ?? envApiBase ?? nativeServerUrl ?? localBetaServerUrl,
  );
}

async function loadAppSnapshot() {
  try {
    return await appSnapshot();
  } catch {
    return null;
  }
}
