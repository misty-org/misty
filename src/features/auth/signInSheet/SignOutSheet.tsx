import { reportSystemError } from "@/features/support/systemErrors";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useAuth } from "../AuthContext";

const useSignOutSheetStore = create<{ open: boolean }>(() => ({ open: false }));

/** Asks before signing out, with the one choice signing out has. */
export function openSignOutSheet() {
  useSignOutSheetStore.setState({ open: true });
}

/**
 * Signing out keeps browsing: sync, Spaces and agents stop on this device, and the window
 * goes on with the personal Space's tabs, bookmarks, passwords and history, which belong to
 * no account again. Removing them is a choice, off by default
 * (docs/design/no-account-browsing/BRIEF.md, decision 2).
 */
export function SignOutSheet() {
  const open = useSignOutSheetStore((state) => state.open);
  const { logout } = useAuth();
  const [removeData, setRemoveData] = useState(false);

  useEffect(() => {
    if (open) setRemoveData(false);
    // Native page views draw above the app, so hide them while the sheet is up.
    setBrowserWebviewsSuspended(open, "sign-out-sheet");
    return () => setBrowserWebviewsSuspended(false, "sign-out-sheet");
  }, [open]);

  const close = () => useSignOutSheetStore.setState({ open: false });
  const signOut = () => {
    close();
    void logout({ removeData }).catch((error: unknown) =>
      reportSystemError({ scope: "account:sign-out", title: "Could not sign out", error }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent aria-describedby="sign-out-description" className="max-w-[440px]">
        <DialogTitle className="text-lg">Sign out of Misty?</DialogTitle>
        <DialogDescription id="sign-out-description">
          Sync, Spaces and agents stop on this device. You keep browsing with your tabs, bookmarks,
          passwords, history and extensions.
        </DialogDescription>
        <label className="flex items-start gap-3 text-sm text-cream">
          <Checkbox
            className="mt-0.5"
            checked={removeData}
            onCheckedChange={(checked) => setRemoveData(checked === true)}
          />
          <span>
            Also remove my browsing data from this device
            <span className="mt-0.5 block text-xs text-cream-muted">
              Erases tabs, bookmarks, passwords, history and website sign-ins here. Your account
              keeps its synced copy.
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
