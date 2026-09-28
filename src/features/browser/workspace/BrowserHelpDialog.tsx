import { useEffect } from "react";
import { SupportRecoverySection } from "@/features/support";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

/** The app's Help panel, opened from the browser's More menu. */
export function BrowserHelpDialog(props: { request: number; suspensionReason: string }) {
  const overlay = useBrowserOverlayControl(props.suspensionReason);
  useEffect(() => {
    if (props.request) overlay.onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request]);
  return (
    <Dialog open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="app-pages-root flex max-h-[min(760px,calc(100dvh-4rem))] max-w-3xl flex-col gap-0 overflow-hidden p-0"
      >
        <header className="shrink-0 border-b border-charcoal-border px-5 py-5 pr-16">
          <DialogTitle className="text-base font-semibold">Help</DialogTitle>
        </header>
        <div className="misty-scrollbar min-h-0 overflow-y-auto overscroll-contain p-5">
          <SupportRecoverySection onClose={() => overlay.onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
