import { MessageCirclePlus } from "lucide-react";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toolbarIconProps,
} from "@/shared/ui";
import type { BrowserMistyPage } from "./browserRuntime";

/** Optional page attachment for the next conversation. */
export function BrowserAgentAccessMenu(props: {
  overlay: { open: boolean; onOpenChange: (open: boolean) => void };
  agentAccess: boolean;
  nativeRuntime: boolean;
  mistyPage: BrowserMistyPage | null;
  mistyPageLoading: boolean;
  onAttachPage: () => void;
}) {
  return (
    <Popover open={props.overlay.open} onOpenChange={props.overlay.onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton label="Page context for Misty" tooltip={false} data-active={props.agentAccess}>
          <MessageCirclePlus {...toolbarIconProps} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-72">
        <p className="m-0 text-sm font-medium">Page context</p>
        <p className="mb-3 mt-1 text-xs text-cream-muted">
          Include this page’s text in your next message to Misty.
        </p>
        <p className="m-0 text-xs text-cream-muted">
          {props.agentAccess
            ? "Misty is working with this tab."
            : "Misty can take control of the screen when your task needs it."}
        </p>
        <div className="mt-3 border-t border-charcoal-border pt-3">
          <p className="m-0 text-xs font-medium">Attach page text</p>
          <p className="mb-2 mt-1 text-[11px] text-cream-muted">
            Capture the current text to discuss it in your conversation.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            disabled={props.mistyPageLoading || !props.nativeRuntime}
            onClick={props.onAttachPage}
          >
            {props.mistyPageLoading
              ? "Reading page…"
              : props.mistyPage
                ? "Refresh page context"
                : "Include page in chat"}
          </Button>
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
