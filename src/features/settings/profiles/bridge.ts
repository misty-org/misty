import type { PreferenceValue } from "./registry";
let writer: ((id: string, value: PreferenceValue) => Promise<void>) | null = null;
export function registerProfileWriter(next: typeof writer) {
  writer = next;
}
export function writeProfilePreference(id: string, value: PreferenceValue): Promise<void> {
  return (
    writer?.(id, value) ??
    Promise.reject(new Error("Settings profiles are still loading. Try again shortly."))
  );
}
