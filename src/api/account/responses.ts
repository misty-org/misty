/** Turns account API responses into payloads or readable errors. */
export class AccountApiError extends Error {
  name = "AccountApiError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export function isAccountUnauthorizedError(error: unknown): boolean {
  return error instanceof AccountApiError && error.status === 401;
}
export async function parseResponse<T>(
  response: Response,
  method: string,
  path: string,
  url: string,
): Promise<T> {
  const payload = await parsePayload(response, method, path);
  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload.trim()
        : responseMessage(payload) || responseError(payload);
    const requestUrl = response.url || url;
    const fallback = `${method} ${requestUrl} failed: ${response.status} ${response.statusText || "HTTP error"}`;
    const errorMessage = message || fallback;
    recordAccountApiDebugEvent({
      level: "error",
      scope: "account-api",
      message: errorMessage,
      detail: `${fallback}\n${payloadDetail(payload)}`,
    });
    throw new AccountApiError(errorMessage, response.status);
  }
  return payload as T;
}
async function parsePayload(response: Response, method: string, path: string): Promise<unknown> {
  const text = await response.text();
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return text;
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const firstJsonValue = firstJsonValueText(text);
    if (firstJsonValue) return JSON.parse(firstJsonValue);
    throw new AccountApiError(
      `Misty server returned malformed JSON for ${method} ${path}: ${textPreview(text)}${error instanceof Error ? ` (${error.message})` : ""}`,
      response.status,
    );
  }
}
export function recordAccountApiDebugEvent(event: {
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
  detail?: string;
}): void {
  if (!import.meta.env.DEV && import.meta.env.VITE_MISTY_DEBUG !== "1") {
    return;
  }
  void import("@/shared/platform/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent(event);
  });
}
function textPreview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160) || "empty response";
}
function firstJsonValueText(value: string): string | null {
  const start = value.search(/[[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}
function responseMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const message = (
    payload as {
      message?: unknown;
    }
  ).message;
  return typeof message === "string" ? message : "";
}
function responseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const error = (
    payload as {
      error?: unknown;
    }
  ).error;
  return typeof error === "string" ? error : "";
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Network request failed.";
}
function payloadDetail(payload: unknown): string {
  if (typeof payload === "string") return payload.slice(0, 800);
  try {
    return JSON.stringify(payload, null, 2).slice(0, 800);
  } catch {
    return "";
  }
}
