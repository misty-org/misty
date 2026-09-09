import { MistySDKError } from "@misty/sdk";

export function plannerEnum<const T extends readonly string[]>(
  value: unknown,
  options: T,
): T[number] {
  if (typeof value !== "string" || !options.includes(value))
    throw new MistySDKError(
      "invalid_response",
      "The server returned an unsupported Planner value.",
    );
  return value as T[number];
}

export function plannerRecord(value: unknown): Record<string, unknown> {
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new MistySDKError("invalid_response", "The server returned invalid Planner metadata.");
  return value as Record<string, unknown>;
}
