import { reportSystemError } from "@/shared/platform/systemErrors";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Text,
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
 * Signing out goes back to the sign-in page. The account's agents and chats stay on this
 * computer for when it signs in again; removing the browsing data is a choice, off by default.
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
      <DialogContent aria-describedby="sign-out-description" className="max-w-110">
        <DialogTitle className="text-lg">Sign out of Misty?</DialogTitle>
        <DialogDescription id="sign-out-description">
          Your agents and chats stay on this computer for when you sign in again.
        </DialogDescription>
        <Text bare as="label" tone="default" className="flex items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={removeData}
            onCheckedChange={(checked) => setRemoveData(checked === true)}
          />
          <span>
            Also remove my browsing data from this computer
            <Text bare tone="muted" className="mt-0.5 block text-xs">
              Erases tabs, bookmarks, passwords, history and website sign-ins here.
            </Text>
          </span>
        </Text>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
