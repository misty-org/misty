import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { vaultNative, type VaultState } from "./native";

/** Where sync stands on this computer, shared by every part of the window that shows it. */
export const useVaultState = create<{ vault: VaultState | null }>(() => ({ vault: null }));

let refreshing: Promise<void> | undefined;
let again = false;

export function refreshVaultState(): Promise<void> {
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = vaultNative
    .state()
    .then((vault) => useVaultState.setState({ vault }))
    .catch(() => {
      // Keep what's known; with nothing known yet, say so rather than wait forever.
      if (!useVaultState.getState().vault) {
        useVaultState.setState({
          vault: { state: "off", exists: null, asked: false, notice: null },
        });
      }
    })
    .finally(() => {
      refreshing = undefined;
      if (again) {
        again = false;
        void refreshVaultState();
      }
    });
  return refreshing;
}

/** Follows the vault while the window is open. Picks the link back up if this computer has the key. */
export function startVaultState(): () => void {
  if (!hasTauriInternals()) return () => undefined;
  let stopped = false;
  const stopListening = listen("misty://vault-status", () => {
    if (!stopped) void refreshVaultState();
  }).catch(() => undefined);
  void vaultNative
    .resume()
    .catch(() => undefined)
    .finally(() => (stopped ? undefined : refreshVaultState()));
  // Offline when it last asked: the server's answer is still owed, and with it the first offer.
  const askAgain = () => {
    const { vault } = useVaultState.getState();
    if (!vault || (vault.state === "off" && vault.exists === null)) void refreshVaultState();
  };
  window.addEventListener("focus", askAgain);
  window.addEventListener("online", askAgain);
  return () => {
    stopped = true;
    window.removeEventListener("focus", askAgain);
    window.removeEventListener("online", askAgain);
    void stopListening.then((stop) => stop?.());
  };
}
