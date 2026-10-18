import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isIncognitoWindow } from "./spaceWindow";

/**
 * Device browser profiles became Spaces. Saved state from before still lists them;
 * their website data stores are erased once, natively, and the list is dropped.
 */
export function eraseRetiredBrowserProfiles(saved: unknown): void {
  if (!Array.isArray(saved) || !hasTauriInternals() || isIncognitoWindow()) return;
  const stores = saved
    .map((profile: { dataId?: unknown } | null) => profile?.dataId)
    .filter((id): id is string => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))
    .slice(0, 100);
  if (!stores.length) return;
  // After start-up, so erasing never holds up the first paint.
  setTimeout(() => {
    void invoke("browser_retired_profiles_erase", { profileIds: stores }).catch(() => undefined);
  }, 5000);
}
