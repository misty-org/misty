export type ClientDebugLevel = "info" | "warn" | "error";

export interface ClientDebugEvent {
  id: string;
  createdAt: string;
  level: ClientDebugLevel;
  scope: string;
  message: string;
  detail?: string;
}

const debugStorageKey = "misty.clientDebug.events.v1";
const maxDebugEvents = 40;
let installed = false;

export function installClientDebugging(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    recordClientDebugEvent({
      level: "error",
      scope: "window.error",
      message: event.message || "Unhandled browser error",
      detail: formatErrorDetail(event.error),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordClientDebugEvent({
      level: "error",
      scope: "window.unhandledrejection",
      message: reasonMessage(event.reason),
      detail: formatErrorDetail(event.reason),
    });
  });
}

export function recordClientDebugEvent(event: Omit<ClientDebugEvent, "id" | "createdAt">): void {
  if (typeof window === "undefined") return;
  const entry: ClientDebugEvent = {
    ...event,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  try {
    const events = [entry, ...readClientDebugEvents()].slice(0, maxDebugEvents);
    window.localStorage.setItem(debugStorageKey, JSON.stringify(events));
    window.dispatchEvent(new CustomEvent("misty-client-debug"));
  } catch {
    // Debug storage should never break the app path that is being debugged.
  }
}

export function readClientDebugEvents(): ClientDebugEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(debugStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isClientDebugEvent) : [];
  } catch {
    return [];
  }
}

export function clearClientDebugEvents(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(debugStorageKey);
    window.dispatchEvent(new CustomEvent("misty-client-debug"));
  } catch {
    // Ignore unavailable storage.
  }
}

export function clientDebugPanelEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1";
}

function isClientDebugEvent(value: unknown): value is ClientDebugEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.createdAt === "string"
    && typeof candidate.level === "string"
    && typeof candidate.scope === "string"
    && typeof candidate.message === "string";
}

function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "Unhandled promise rejection";
}

function formatErrorDetail(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return undefined;
  }
}
