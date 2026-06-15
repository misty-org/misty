import { httpRequest } from "@/api/client/http";
import {
  apiRequestCredentials,
  isApiSessionTransitioning,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { resolveApiBase } from "@/api/deployment/api";
import { addRequestCorrelation } from "@/shared/platform/requestCorrelation";

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
  const accountGeneration = readApiSessionGeneration();
  assertStableManagedAiAccount(accountGeneration);
  const base = await resolveApiBase();
  assertStableManagedAiAccount(accountGeneration);
  if (!base) throw new Error("Misty server URL is not configured.");
  const token = await readApiAuthToken();
  assertStableManagedAiAccount(accountGeneration);
  const headers = new Headers(init?.headers);
  addRequestCorrelation(headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await httpRequest(`${base}${path}`, {
      credentials: apiRequestCredentials(),
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
    const payload = parseManagedAiError(text);
    if (payload?.code === "hosted_ai_limit_reached") {
      const reset = payload.reset_at ? new Date(payload.reset_at).toLocaleDateString() : "Monday";
      throw new ManagedAiRequestError(
        `Weekly hosted AI usage is fully used. Try again after the reset on ${reset}, or upgrade to Pro from Account settings.`,
        response.status,
        payload.code,
      );
    }
    if (payload?.code === "rate_limited") {
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
    if (payload?.code === "request_canceled") {
      throw new ManagedAiRequestError("Agent request canceled.", response.status, payload.code);
    }
    if (payload?.message?.trim()) {
      throw new ManagedAiRequestError(
        payload.message.trim(),
        response.status,
        payload.code,
        payload.retry_after_seconds ?? retryAfterHeader(response),
      );
    }
    if (payload?.code?.trim()) {
      throw new ManagedAiRequestError(
        "The request could not be completed.",
        response.status,
        payload.code.trim(),
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

function parseManagedAiError(text: string): ManagedAiErrorPayload | null {
  try {
    return JSON.parse(text) as ManagedAiErrorPayload;
  } catch {
    return null;
  }
}

function assertStableManagedAiAccount(generation: number): void {
  if (isApiSessionTransitioning() || generation !== readApiSessionGeneration()) {
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
