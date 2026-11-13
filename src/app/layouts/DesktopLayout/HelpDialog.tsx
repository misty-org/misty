import { TourInfoButton } from "@/features/onboarding";
import { useEffect } from "react";
import { create } from "zustand";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { SupportRecoverySection } from "@/features/support";
import { BottomBar, Dialog, DialogContent, DialogTitle } from "@/shared/ui";

/** Whether Help is open. The account menu opens it; the dialog lives beside the shell. */
export const useHelpDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Help: recovery actions, a support bundle and a feedback draft. */
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
      <DialogContent
        aria-describedby={undefined}
        className="app-pages-root flex max-h-[min(760px,calc(100dvh-4rem))] max-w-3xl flex-col gap-0 overflow-hidden p-0"
      >
        <header className="shrink-0 border-b px-5 py-5 pr-16">
          <DialogTitle className="text-base font-semibold">Help</DialogTitle>
        </header>
        <div className="misty-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {open ? <SupportRecoverySection onClose={() => setOpen(false)} /> : null}
        </div>
        <BottomBar aria-label="Help">
          <TourInfoButton tour="help" />
        </BottomBar>
      </DialogContent>
    </Dialog>
  );
}
