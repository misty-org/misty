import { resolveApiBase } from "@/api/deployment/api";
import { addRequestCorrelation } from "@/shared/platform/requestCorrelation";
import { ApiRequestError, decodeApiError } from "./errors";
import { httpRequest } from "./http";
import {
  apiRequestCredentials,
  isApiSessionTransitioning,
  notifyApiSessionInvalid,
  readApiAuthToken,
  readApiSessionGeneration,
} from "./session";

export type ApiRequest = <T = void>(path: string, init?: RequestInit) => Promise<T>;

/** Authenticated request primitive for every Misty server domain. */
export async function apiRequest<T = void>(path: string, init: RequestInit = {}): Promise<T> {
  const { response, accountGeneration } = await authenticatedResponse(path, init);
  if (response.status === 204) return undefined as T;

  const result = (await response.json()) as T;
  assertStableApiSession(accountGeneration);
  return result;
}

/** Authenticated binary response primitive for domain clients. */
export async function apiBlobRequest(path: string, init: RequestInit = {}): Promise<Blob> {
  const { response, accountGeneration } = await authenticatedResponse(path, init);
  const result = await response.blob();
  assertStableApiSession(accountGeneration);
  return result;
}

async function authenticatedResponse(
  path: string,
  init: RequestInit,
): Promise<{ response: Response; accountGeneration: number }> {
  const accountGeneration = readApiSessionGeneration();
  assertStableApiSession(accountGeneration);
  const [base, token] = await Promise.all([resolveRequiredApiBase(), readApiAuthToken(path)]);
  assertStableApiSession(accountGeneration);

  const headers = new Headers(init.headers);
  addRequestCorrelation(headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await httpRequest(`${base}${path}`, {
      credentials: apiRequestCredentials(),
      ...init,
      headers,
    });
  } catch (error) {
    assertStableApiSession(accountGeneration);
    throw error;
  }
  assertStableApiSession(accountGeneration);

  if (!response.ok) {
    const text = await response.text();
    assertStableApiSession(accountGeneration);
    if (response.status === 401 && token) notifyApiSessionInvalid();
    const decoded = decodeApiError(text);
    throw new ApiRequestError(decoded.message, response.status, decoded.code, text);
  }
  return { response, accountGeneration };
}

export async function resolveRequiredApiBase(): Promise<string> {
  const base = await resolveApiBase();
  if (!base) throw new Error("Misty server URL is not configured.");
  return base;
}

export function assertStableApiSession(generation: number): void {
  if (isApiSessionTransitioning() || generation !== readApiSessionGeneration()) {
    throw new ApiRequestError("Wait for the account switch to finish.", 409, "account_changed");
  }
}
