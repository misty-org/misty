import { useEffect } from "react";
import { create } from "zustand";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { SupportRecoverySection } from "@/features/support";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@misty/ui";

export const useHelpDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function HelpDialog() {
  const open = useHelpDialog((state) => state.open);
  const setOpen = useHelpDialog((state) => state.setOpen);
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
