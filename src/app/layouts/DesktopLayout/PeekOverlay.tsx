import type { ReactNode } from "react";
import { Maximize2, X } from "lucide-react";
import { tabLabel } from "@/features/workspace/layoutTabs";
import type { WorkspaceTab } from "@/features/workspace/model";
import { Button, IconButton } from "@/shared/ui";

/** A peeked link floating over the page it came from, with its own header. */
export function PeekOverlay(props: {
  tab: WorkspaceTab;
  children: ReactNode;
  onKeep(): void;
  onClose(): void;
}) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-stretch justify-center bg-black/45 p-[3%]"
      onPointerDown={(event) => {
        // A press on the dimmed page beside the card closes the peek.
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={`Peek: ${tabLabel(props.tab)}`}
        className="flex w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-bg shadow-2xl"
        data-browser-corner-clip=""
      >
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-charcoal-border pl-3 pr-1">
          <span className="min-w-0 flex-1 truncate text-xs text-cream-muted">
            {tabLabel(props.tab)}
          </span>
          <Button size="sm" variant="ghost" onClick={props.onKeep}>
            <Maximize2 className="size-3.5" aria-hidden />
            Open as tab
          </Button>
          <IconButton size="xs" label="Close peek" onClick={props.onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>
        <div role="tabpanel" className="min-h-0 flex-1" aria-label={tabLabel(props.tab)}>
          {props.children}
        </div>
      </div>
    </div>
  );
}
