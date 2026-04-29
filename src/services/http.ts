import { addRequestCorrelation } from "@/shared/platform/requestCorrelation";

/** The single browser-network primitive used by domain services. */
export async function httpRequest(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = addRequestCorrelation(new Headers(init.headers));
  try {
    return await fetch(input, { ...init, headers });
  } catch (error) {
    throw new HttpRequestError(input.toString(), error);
  }
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
