import { MoreHorizontal } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";
import { CopyButton } from "../controls/CopyButton";
import { IconButton } from "../controls/IconButton";
import { renderIcon, type IconSource } from "../layout/ActionBar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../overlays/DropdownMenu";

type MessageAction = {
  /** Stable key. An action with id "copy" confirms with a check unless `confirms` says otherwise. */
  id: string;
  icon: IconSource;
  /** What it does, in sentence case: the button's name and tooltip. */
  label: string;
  /** The shortcut as it reads, such as "⌘C", shown in the tooltip while hints are on. */
  shortcut?: string;
  /**
   * Runs the action. It gets the click, e.g. to find the message the button sits in. Return a
   * promise to confirm only once it resolves; it handles and reports its own errors.
   */
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
  /** Only for actions that delete: the icon turns the danger color. */
  danger?: boolean;
  /** A toggle that is on, such as a thumbs up already given. */
  pressed?: boolean;
  /** Off for now (an agent is still working). Leave out actions that never apply here. */
  disabled?: boolean;
  /** Swaps the icon for a check for 1.5s after it runs, with no words. Defaults to `id === "copy"`. */
  confirms?: boolean;
};

type MessageActionsProps = {
  /** The message's edge: "end" under the person's own messages, "start" under replies. */
  align: "start" | "end";
  /**
   * Always shown, on the latest message. Otherwise the bar shows while the nearest `[data-message]`
   * around it is hovered or holds focus.
   */
  alwaysVisible?: boolean;
  actions: readonly MessageAction[];
  /** Rarer actions as MenuItems, behind a ⋯ at the end of the bar. */
  overflow?: React.ReactNode;
  /** Quiet text beside the buttons on the side away from the edge, such as the message's time. */
  trailing?: React.ReactNode;
  /** The bar's accessible name. Defaults to "Message actions". */
  label?: string;
  className?: string;
};

function MessageActionButton({ action }: { action: MessageAction }) {
  const shared = {
    label: action.label,
    shortcut: action.shortcut,
    variant: "quiet",
    size: "sm",
    disabled: action.disabled,
    "aria-pressed": action.pressed,
    "data-action": action.id,
    className: cn(action.danger && "text-danger hover:bg-danger-wash hover:text-danger"),
  } as const;
  // Copy and other confirming actions are the shared CopyButton: a check for a moment, no words.
  if (action.confirms ?? action.id === "copy")
    return <CopyButton {...shared} icon={action.icon} onCopy={action.onSelect} />;
  return (
    <IconButton {...shared} onClick={action.onSelect}>
      {renderIcon(action.icon)}
    </IconButton>
  );
}

/**
 * The one action bar under every message: a row of 24px quiet icon buttons with tooltips, aligned
 * to the message's edge. It shows while the message (the nearest `[data-message]` around it) is
 * hovered or holds focus, and always on the latest message. Copy confirms by swapping its icon
 * for a check for 1.5s.
 *
 * ```tsx
 * <div data-message>
 *   <MessageBody … />
 *   <MessageActions align="start" alwaysVisible={latest} actions={[
 *     { id: "copy", icon: Copy, label: "Copy", onSelect: () => navigator.clipboard.writeText(text) },
 *     { id: "retry", icon: RotateCcw, label: "Try again", onSelect: retry },
 *   ]} overflow={<MenuItem icon={Trash2} label="Delete" danger onSelect={askDelete} />} />
 * </div>
 * ```
 */
function MessageActions({
  align,
  alwaysVisible = false,
  actions,
  overflow,
  trailing,
  label = "Message actions",
  className,
}: MessageActionsProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  if (actions.length === 0 && !overflow && !trailing) return null;
  // The time sits on the far side, so the buttons stay at the message's edge.
  const trailingText = trailing ? (
    <span
      data-slot="message-actions-trailing"
      className="shrink-0 px-1 text-meta whitespace-nowrap text-cream-muted tabular-nums"
    >
      {trailing}
    </span>
  ) : null;
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="message-actions"
      data-align={align}
      data-visible={alwaysVisible || menuOpen || undefined}
      className={cn(
        "flex h-6 min-w-0 items-center gap-1",
        align === "end" ? "justify-end" : "justify-start",
        "opacity-0 transition-opacity focus-within:opacity-100 data-[visible]:opacity-100",
        "[[data-message]:hover_&]:opacity-100 [[data-message]:focus-within_&]:opacity-100",
        // Without hover (touch screens) there is nothing to reveal it, so it stays.
        "[@media(hover:none)]:opacity-100",
        className,
      )}
    >
      {align === "end" ? trailingText : null}
      {actions.map((action) => (
        <MessageActionButton key={action.id} action={action} />
      ))}
      {overflow ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <IconButton label="More actions" variant="quiet" size="sm">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={align} aria-label="More actions">
            {overflow}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {align === "start" ? trailingText : null}
    </div>
  );
}

export { MessageActions };
export type { MessageAction, MessageActionsProps };
