import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui";
import { vaultNative, type VaultNotice, type VaultState } from "./native";
import { startVaultState, refreshVaultState, useVaultState } from "./useVaultState";
import { VaultPasswordDialog } from "./VaultPasswordDialog";

const notices: Record<VaultNotice, { title: string; body: string }> = {
  storage_full: {
    title: "Sync storage is full",
    body: "New changes stay on this computer until there's room. Changes from your other computers keep arriving.",
  },
  session_removed: {
    title: "Sync stopped on this computer",
    body: "This computer was removed from sync. Everything here stays. To sync again, enter your sync password in Settings.",
  },
  vault_gone: {
    title: "Sync stopped",
    body: "The vault was destroyed or its password changed. Everything here stays. To sync again, go to Settings.",
  },
};

/** An account given no storage isn't full, and shouldn't be told so. */
const noStorage = {
  title: "This account has no sync storage yet",
  body: "Everything stays on this computer, and starts syncing as soon as the account has storage.",
};

function noticeOf(vault: VaultState | null): VaultNotice | null {
  if (vault?.state === "off") return vault.notice;
  if (vault?.state === "on") return vault.status.notice;
  return null;
}

/** Sync's only presence outside Settings: the first offer, and the few things that need the person. */
export function VaultStartup() {
  const vault = useVaultState((state) => state.vault);
  const [dismissed, setDismissed] = useState(false);
  const [seen, setSeen] = useState<VaultNotice | null>(null);

  useEffect(() => startVaultState(), []);
  // With several windows open, only the one in use asks; an answer closes it everywhere. It stays
  // up once shown, so stepping away to fetch a password doesn't clear what's typed. The window's
  // own focus counts a click on a page, which the renderer's document never hears about.
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const current = getCurrentWindow();
    void current
      .isFocused()
      .then((now) => (now ? setFocused(true) : undefined))
      .catch(() => undefined);
    const stop = current
      .onFocusChanged(({ payload }) => (payload ? setFocused(true) : undefined))
      .catch(() => undefined);
    return () => void stop.then((unlisten) => unlisten?.());
  }, []);

  const offering =
    focused && !dismissed && vault?.state === "off" && vault.exists !== null && !vault.asked;
  const notice = noticeOf(vault);
  const [storageGiven, setStorageGiven] = useState(true);
  useEffect(() => {
    if (notice !== "storage_full") return;
    let current = true;
    void vaultNative
      .usage()
      .then((usage) => (current ? setStorageGiven(usage.limitBytes !== 0) : undefined))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [notice]);
  const text = notice === "storage_full" && !storageGiven ? noStorage : notice && notices[notice];
  const showing = focused && notice !== seen ? text : null;

  return (
    <>
      <VaultPasswordDialog
        mode={vault?.state === "off" && vault.exists ? "unlock" : "create"}
        open={offering && !showing}
        dismissLabel="Not now"
        onDismiss={() => {
          setDismissed(true);
          void vaultNative
            .decline()
            .catch(() => undefined)
            .finally(() => void refreshVaultState());
        }}
        onDone={() => setDismissed(true)}
      />
      <AlertDialog open={Boolean(showing)} onOpenChange={(open) => (open ? null : setSeen(notice))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{showing?.title}</AlertDialogTitle>
            <AlertDialogDescription>{showing?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSeen(notice)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
