import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui";
import type { ReactNode } from "react";

export function MobileFullScreenSheet(props: {
  open: boolean;
  title: string;
  description?: string;
  dirty?: boolean;
  doneLabel?: string;
  doneDisabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
  children: ReactNode;
}) {
  const requestOpenChange = (open: boolean) => {
    if (!open && props.dirty) {
      const discard = window.confirm("Discard your unsaved changes?");
      if (!discard) return;
    }
    props.onOpenChange(open);
  };

  return (
    <Sheet open={props.open} onOpenChange={requestOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="grid h-[calc(100dvh-env(safe-area-inset-top))] max-h-none grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none border-x-0 border-b-0 bg-charcoal-bg p-0"
      >
        <SheetHeader className="grid min-h-14 grid-cols-[minmax(64px,auto)_minmax(0,1fr)_minmax(64px,auto)] items-center gap-2 border-b border-charcoal-border px-2 text-center">
          <button
            type="button"
            className="min-h-11 justify-self-start rounded-lg px-3 text-sm text-cream-muted active:bg-charcoal-card active:text-cream-bright"
            onClick={() => requestOpenChange(false)}
          >
            Cancel
          </button>
          <span className="min-w-0">
            <SheetTitle className="truncate text-[15px] font-semibold">{props.title}</SheetTitle>
            {props.description ? (
              <SheetDescription className="truncate text-xs">{props.description}</SheetDescription>
            ) : null}
          </span>
          {props.onDone ? (
            <button
              type="button"
              className="min-h-11 justify-self-end rounded-lg px-3 text-sm font-semibold text-cream-bright active:bg-charcoal-card disabled:text-cream-muted"
              disabled={props.doneDisabled}
              onClick={props.onDone}
            >
              {props.doneLabel ?? "Done"}
            </button>
          ) : (
            <span />
          )}
        </SheetHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain pb-[max(16px,env(safe-area-inset-bottom))] [scroll-padding-bottom:calc(24px+env(safe-area-inset-bottom))]">
          {props.children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
