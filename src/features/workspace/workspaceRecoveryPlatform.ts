import { deploymentStorageKey } from "@/api/deployment/api";
import { workspaceRecoveryKey } from "./workspaceRecoveryStorage";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";

export const workspaceStoreStorageKey = import.meta.env.MISTY_OFFICIAL_APP_ID
  ? `misty:official-app:${import.meta.env.MISTY_OFFICIAL_APP_ID}:dock:v1`
  : "misty:desktop-dock:space-apps-v1";

export function nativeWorkspaceRecoveryEnabled() {
  return hasTauriInternals() && !isNativeMobileBuild && !import.meta.env.MISTY_OFFICIAL_APP_ID;
}

// Freeze ownership before AuthProvider updates display metadata for another
// account. Kept outside the workspace store's import cycle.
let candidate: { owner: string; raw: string; backup: string | null } | undefined;
let captured = false;
export function captureLegacyWorkspaceOwner() {
  if (captured) return;
  captured = true;
  try {
    const user = JSON.parse(localStorage.getItem(deploymentStorageKey("misty_user")) ?? "null");
    const activeId = localStorage.getItem(deploymentStorageKey("misty:active-account-id"));
    const raw = localStorage.getItem(workspaceStoreStorageKey);
    if (user?.id && user.id === activeId && raw !== null)
      candidate = {
        owner: user.id,
        raw,
        backup: localStorage.getItem(workspaceRecoveryKey(workspaceStoreStorageKey)),
      };
  } catch {
    /* An unowned global record stays untouched. */
  }
}
export const legacyWorkspaceCandidate = () => candidate;
