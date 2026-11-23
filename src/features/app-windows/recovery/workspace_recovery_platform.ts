import { hasTauriInternals } from "@/shared/platform/tauri";
export const workspaceStoreStorageKey = "misty:desktop-dock:space-apps-v1";
export function nativeWorkspaceRecoveryEnabled() {
  return hasTauriInternals();
}
