/** JSON IPC transport; binary data never becomes a native path or a command. */
export function encodeNativeAppValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { $mistyBytes: Array.from(new Uint8Array(value)) };
  if (Array.isArray(value)) return value.map(encodeNativeAppValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodeNativeAppValue(item)]),
    );
  return value ?? null;
}
export function decodeNativeAppValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) return value.map(decodeNativeAppValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && Array.isArray(record.$mistyBytes)) {
      if (!record.$mistyBytes.every((item) => Number.isInteger(item) && item >= 0 && item <= 255))
        throw new Error("Invalid App binary payload.");
      return new Uint8Array(record.$mistyBytes).buffer;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decodeNativeAppValue(item)]),
    );
  }
  return value;
}
