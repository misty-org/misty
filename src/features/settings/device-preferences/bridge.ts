import type { PreferenceValue } from "./registry";
export interface PreferenceWriteOptions {
  stage?: boolean;
}
let writer:
  ((id: string, value: PreferenceValue, options?: PreferenceWriteOptions) => Promise<void>) | null =
  null;
export function registerPreferenceWriter(next: typeof writer) {
  writer = next;
}
export function writeDevicePreference(
  id: string,
  value: PreferenceValue,
  options?: PreferenceWriteOptions,
): Promise<void> {
  return (
    writer?.(id, value, options) ??
    Promise.reject(new Error("Settings are still loading. Try again shortly."))
  );
}
