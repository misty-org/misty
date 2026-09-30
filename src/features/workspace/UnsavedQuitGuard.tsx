import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { flushWorkspaceRecovery } from "@/features/browser-workspace/recovery";

interface HeldQuit {
  unsaved: number;
  /** Only the main window is closing; the app keeps running. */
  closing: boolean;
}
const finish = (closing: boolean) => invoke("app_quit_confirmed", { closing });

/** Native holds quit (or closing the main window) while some workspace saves
 * exist only in this window. Save them first; ask only if that still fails. */
export function UnsavedQuitGuard() {
  const [held, setHeld] = useState<HeldQuit | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const stop = listen<HeldQuit>("misty://unsaved-before-quit", async ({ payload }) => {
      try {
        await flushWorkspaceRecovery();
        await finish(payload.closing);
      } catch {
        setHeld(payload);
      }
    });
    return () => void stop.then((unlisten) => unlisten());
  }, []);
  if (!held) return null;
  const changes = `${held.unsaved} change${held.unsaved === 1 ? "" : "s"}`;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) setHeld(null);
      }}
    >
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Some changes are not saved on this device</AlertDialogTitle>
          <AlertDialogDescription>
            {changes} exist only in this window. Keep Misty open so it can keep trying, or{" "}
            {held.closing ? "close" : "quit"} without them. Anything already synced stays on your
            other devices.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep Misty open</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              setBusy(true);
              void finish(held.closing).finally(() => setBusy(false));
            }}
          >
            {held.closing ? "Close anyway" : "Quit anyway"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
