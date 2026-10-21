import type { PreferenceValue } from "./registry";
export interface ProfileWriteOptions {
  /** Hold the edit for the settings page's Save changes instead of committing it. */
  stage?: boolean;
}
let writer:
  ((id: string, value: PreferenceValue, options?: ProfileWriteOptions) => Promise<void>) | null =
  null;
export function registerProfileWriter(next: typeof writer) {
  writer = next;
}
export function writeProfilePreference(
  id: string,
  value: PreferenceValue,
  options?: ProfileWriteOptions,
): Promise<void> {
  return (
    writer?.(id, value, options) ??
    Promise.reject(new Error("Settings are still loading. Try again shortly."))
  );
}
