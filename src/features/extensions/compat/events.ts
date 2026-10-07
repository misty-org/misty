import { extensionsNative } from "../native";

/** Request fields Misty's native extension host forwards with each call. */
export interface CompatCaller {
  /** The installation id of the calling extension. */
  id: string;
  /** Whether the account allowed this extension in private tabs. */
  privateAccess: boolean;
}

export type CompatHandler = (args: unknown[], caller: CompatCaller) => unknown;

/**
 * Delivers an extension API event. The native host sends it only to
 * extensions whose granted permissions cover the event's namespace.
 */
export function emitCompatEvent(
  event: string,
  args: unknown[],
  target: { id?: string; private?: boolean } = {},
): void {
  void extensionsNative.compat("compat-event", { event, args, ...target }).catch(() => {});
}

/** Reads a WebExtension time value: milliseconds, a Date, or a date string. */
export function compatTime(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function compatObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
