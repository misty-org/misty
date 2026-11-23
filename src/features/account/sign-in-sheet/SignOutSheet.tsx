import { reportSystemError } from "@/shared/platform/system_errors";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Text,
} from "@misty/ui";
import { useEffect, useId, useState } from "react";
import { create } from "zustand";
import { useAuth } from "../AuthContext";

const useSignOutSheetStore = create<{ open: boolean }>(() => ({ open: false }));

export function openSignOutSheet() {
  useSignOutSheetStore.setState({ open: true });
}

export function SignOutSheet() {
  const open = useSignOutSheetStore((state) => state.open);
  const { logout } = useAuth();
  const [removeData, setRemoveData] = useState(false);
  const removeDataId = useId();

  useEffect(() => {
    if (open) setRemoveData(false);
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
        <DialogHeader>
          <DialogTitle>Sign out of Misty?</DialogTitle>
          <DialogDescription id="sign-out-description">
            Your agents and chats stay on this computer for when you sign in again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3">
          <Checkbox
            id={removeDataId}
            className="mt-0.5"
            aria-describedby={`${removeDataId}-detail`}
            checked={removeData}
            onCheckedChange={(checked) => setRemoveData(checked === true)}
          />
          <div className="grid min-w-0 gap-0.5">
            <Label htmlFor={removeDataId}>
              <Text as="span" size="control" tone="default" weight="regular" wrap>
                Also remove my browsing data from this computer
              </Text>
            </Label>
            <Text id={`${removeDataId}-detail`} size="meta" tone="muted" wrap>
              Erases tabs, bookmarks, passwords, history and website sign-ins here.
            </Text>
          </div>
        </div>
        <DialogFooter>
          <Button variant="quiet" size="lg" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" onClick={signOut}>
            Sign out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
