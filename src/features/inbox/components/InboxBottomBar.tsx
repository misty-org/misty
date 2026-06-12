import { IconButton } from "@/shared/ui/icon-button";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

export function InboxBottomBar(props: {
  leftShelfVisible: boolean;
  messageAvailable: boolean;
  messageVisible: boolean;
  accountCount: number;
  messageCount: number;
  onToggleLeftShelf: () => void;
  onToggleMessage: () => void;
}) {
  const LeftIcon = props.leftShelfVisible ? PanelLeftClose : PanelLeftOpen;
  const RightIcon = props.messageVisible ? PanelRightClose : PanelRightOpen;

  return (
    <footer className="flex min-h-7 shrink-0 items-center justify-between gap-2 border-t border-charcoal-border/60 bg-charcoal-sidebar px-2">
      <IconButton
        label={props.leftShelfVisible ? "Hide left shelf" : "Show left shelf"}
        size="sm"
        tooltip={false}
        variant={props.leftShelfVisible ? "secondary" : "ghost"}
        onClick={props.onToggleLeftShelf}
      >
        <LeftIcon />
      </IconButton>

      <div className="flex min-w-0 items-center gap-2 text-[10px] tabular-nums text-cream-faint">
        <span>
          {props.accountCount} {props.accountCount === 1 ? "account" : "accounts"}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {props.messageCount} {props.messageCount === 1 ? "message" : "messages"}
        </span>
      </div>

      <IconButton
        label={props.messageVisible ? "Hide message" : "Show message"}
        size="sm"
        tooltip={false}
        variant={props.messageVisible ? "secondary" : "ghost"}
        disabled={!props.messageAvailable}
        onClick={props.onToggleMessage}
      >
        <RightIcon />
      </IconButton>
    </footer>
  );
}
