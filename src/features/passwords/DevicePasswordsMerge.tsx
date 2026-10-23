import { listen } from "@tauri-apps/api/event";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { useCallback, useEffect, useState } from "react";
import { passwordsApi } from "./api";

const askedKey = (accountId: string) => `misty.device-passwords-asked:${accountId}`;

function asked(accountId: string): boolean {
  try {
    return localStorage.getItem(askedKey(accountId)) === "1";
  } catch {
    return false;
  }
}

function markAsked(accountId: string) {
  try {
    localStorage.setItem(askedKey(accountId), "1");
  } catch {
    /* Asking again next time is harmless. */
  }
}

/**
 * Passwords saved while browsing without an account live in this device's local vault.
 * When sync turns on they join the account: silently for an account with none yet, and
 * after asking once, with a count, for one that already syncs from other devices
 * (docs/browser/no-account.md, decision 4).
 */
export function DevicePasswordsMerge({ accountId }: { accountId: string }) {
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = count > 0;

  const check = useCallback(async () => {
    if (!accountId || !hasTauriInternals()) return;
    const preview = await passwordsApi.devicePreview().catch(() => null);
    if (!preview || preview.passwords === 0) return;
    if (!preview.accountHasPasswords) {
      await passwordsApi.deviceMerge().catch(() => undefined);
      return;
    }
    if (!asked(accountId)) setCount(preview.passwords);
  }, [accountId]);

  useEffect(() => {
    void check();
    if (!hasTauriInternals()) return;
    // The synced vault opens (sync turned on or unlocked) after this mounts.
    const stop = listen("misty:browser-sync-changed", () => void check());
    return () => void stop.then((unlisten) => unlisten()).catch(() => undefined);
  }, [check]);

  // Native page views draw above the app, so hide them while the question is up.
  useEffect(() => {
    setBrowserWebviewsSuspended(open, "device-passwords-merge");
    return () => setBrowserWebviewsSuspended(false, "device-passwords-merge");
  }, [open]);

  const close = () => {
    markAsked(accountId);
    setCount(0);
    setError("");
  };
  const merge = async () => {
    setBusy(true);
    setError("");
    try {
      await passwordsApi.deviceMerge();
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent aria-describedby="device-passwords-description" className="max-w-[440px]">
        <DialogTitle className="text-lg">Add this device's passwords to your account?</DialogTitle>
        <DialogDescription id="device-passwords-description">
          Your account already has saved passwords. The ones saved on this device join them, and
          duplicates are skipped. Open tabs stay this device's own.
        </DialogDescription>
        <div className="flex items-center justify-between border-y border-charcoal-border py-2 text-sm">
          <span className="text-cream">Saved passwords</span>
          <span className="text-cream-muted">{count}</span>
        </div>
        {error ? <p className="text-sm text-cream">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={close}>
            Not now
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void merge()}>
            Add to account
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
