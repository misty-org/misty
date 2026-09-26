import { MessageCirclePlus } from "lucide-react";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import type { BrowserMistyPage } from "./browserRuntime";
import { browserToolbarStyles } from "./browserToolbarStyles";

/** Run-bound agent access and the one-time Misty page read. */
export function BrowserAgentAccessMenu(props: {
  overlay: { open: boolean; onOpenChange: (open: boolean) => void };
  iconButtonClass: string;
  lightChrome: boolean;
  agentAccess: boolean;
  nativeRuntime: boolean;
  mistyPage: BrowserMistyPage | null;
  mistyPageLoading: boolean;
  onAttachPage: () => void;
}) {
  return (
    <Popover open={props.overlay.open} onOpenChange={props.overlay.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            props.iconButtonClass,
            props.agentAccess &&
              (props.lightChrome
                ? "bg-black/[0.06] text-[#202020]"
                : "bg-white/[0.06] text-[#e9e9e9]"),
          )}
          aria-label={`Agent access: ${props.agentAccess ? "On" : "Off"}`}
        >
          <MessageCirclePlus {...browserToolbarStyles.icon} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 p-3 data-[state=closed]:animate-none data-[state=open]:animate-none"
      >
        <p className="m-0 text-sm font-medium">Run-bound Agent access</p>
        <p className="mb-3 mt-1 text-xs text-cream-muted">
          Attach this tab when you ask an Agent to work. Access belongs only to that run and
          expires automatically.
        </p>
        <p className="m-0 text-xs text-cream-muted">
          {props.agentAccess
            ? "This tab is attached to active Agent work."
            : "No active Agent run is attached to this tab."}
        </p>
        <div className="mt-3 border-t border-charcoal-border pt-3">
          <p className="m-0 text-xs font-medium">Misty page context</p>
          <p className="mb-2 mt-1 text-[11px] text-cream-muted">
            A one-time inspection captures bounded page text. The temporary read grant is
            revoked immediately after capture.
          </p>
          <button
            type="button"
            className="w-full rounded-md border border-charcoal-border bg-charcoal-card px-3 py-2 text-xs hover:bg-charcoal-hover disabled:opacity-50"
            disabled={props.mistyPageLoading || !props.nativeRuntime}
            onClick={props.onAttachPage}
          >
            {props.mistyPageLoading
              ? "Reading page…"
              : props.mistyPage
                ? "Refresh page context"
                : "Allow one-time page read"}
          </button>
          {props.mistyPage ? (
            <p className="mb-0 mt-2 text-[10px] text-cream-muted">
              Attached: {props.mistyPage.title}
              {props.mistyPage.truncated ? " (bounded extract)" : ""}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
