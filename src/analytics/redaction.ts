const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|email|name|path|file|folder|query|clipboard|content|body|url)/i;
const TOKEN = /\b(?:bearer\s+)?[A-Za-z0-9_-]{20,}\b/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const WINDOWS_PATH = /\b[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]*/g;
const UNIX_PATH = /(?:^|\s)(\/(?:Users|home|var|tmp|Volumes|mnt|media)\/[^\s]*)/g;
const URL_VALUE = /https?:\/\/[^\s]+/gi;
const FILE_NAME = /\b[^\s/\\]+\.(?:txt|pdf|docx?|xlsx?|pptx?|csv|tsv|png|jpe?g|gif|webp|zip|rar|7z|md)\b/gi;

export function redactText(value: string): string {
  return value
    .replace(URL_VALUE, redactUrl)
    .replace(EMAIL, "[REDACTED_USER_DATA]")
    .replace(WINDOWS_PATH, "[REDACTED_PATH]")
    .replace(UNIX_PATH, (match) => `${match.startsWith(" ") ? " " : ""}[REDACTED_PATH]`)
    .replace(TOKEN, "[REDACTED_TOKEN]")
    .replace(FILE_NAME, "[REDACTED_USER_DATA]");
}

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[REDACTED_USER_DATA]" : redactValue(item),
  ]));
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return redactRecord(value as Record<string, unknown>);
  return value;
}

export function redactedError(error: unknown): Error {
  const source = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unexpected error");
  const safe = new Error(redactText(source.message));
  safe.name = source.name;
  safe.stack = source.stack ? redactStack(source.stack) : undefined;
  return safe;
}

function redactStack(value: string): string {
  return value
    .replace(URL_VALUE, redactUrl)
    .replace(EMAIL, "[REDACTED_USER_DATA]")
    .replace(WINDOWS_PATH, "[REDACTED_PATH]")
    .replace(UNIX_PATH, (match) => `${match.startsWith(" ") ? " " : ""}[REDACTED_PATH]`)
    .replace(TOKEN, "[REDACTED_TOKEN]");
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.pathname.startsWith("/assets/") ? `${parsed.origin}${parsed.pathname}` : "[REDACTED_REQUEST]";
  } catch {
    return "[REDACTED_REQUEST]";
  }
}
