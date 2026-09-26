import { deploymentStorageKey } from "@/api/deployment/api";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { workspaceRecoveryKey } from "./workspaceRecoveryStorage";
export const workspaceStoreStorageKey = "misty:desktop-dock:space-apps-v1";
export function nativeWorkspaceRecoveryEnabled() {
  return hasTauriInternals();
}

// Freeze ownership before AuthProvider updates display metadata for another
// account. Kept outside the workspace store's import cycle.
let candidate:
  | {
      owner: string;
      raw: string;
      backup: string | null;
    }
  | undefined;
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
