import { useEffect } from "react";
import { create } from "zustand";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { SupportRecoverySection } from "@/features/support";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@misty/ui";

/** Whether Help is open. The account menu opens it; the dialog lives beside the shell. */
export const useHelpDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Help: a tour, setup again, and the safe fixes for a stuck app. */
export function HelpDialog() {
  const open = useHelpDialog((state) => state.open);
  const setOpen = useHelpDialog((state) => state.setOpen);
  // Native page views draw above the app, so hide them while the dialog is up.
  useEffect(() => {
    setBrowserWebviewsSuspended(open, "help-dialog");
    return () => setBrowserWebviewsSuspended(false, "help-dialog");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Help</DialogTitle>
        </DialogHeader>
        {open ? <SupportRecoverySection onClose={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
