import type { ReactNode } from "react";
import { cn } from "../classNames";

/**
 * A button and the menu of its other choices joined into one control: the main action first (an
 * IconButton or Button), then a MenuTrigger with just its chevron, narrowed to the chevron and
 * meeting the button with no gap or corner between them. The group is named by `label`.
 *
 * ```tsx
 * <SplitButton label="Open in">
 *   <IconButton label="Open in Cursor" onClick={open}><CursorIcon /></IconButton>
 *   <DropdownMenu>
 *     <MenuTrigger iconOnly chevron label="Open in another app" />
 *     <DropdownMenuContent>…</DropdownMenuContent>
 *   </DropdownMenu>
 * </SplitButton>
 * ```
 */
export function SplitButton({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  /** Layout only. */
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="split-button"
      className={cn(
        "inline-flex flex-none items-center",
        "[&>*:first-child]:rounded-r-none",
        "[&>*:last-child]:w-4.5 [&>*:last-child]:min-w-4.5 [&>*:last-child]:rounded-l-none",
        "[&>*:last-child]:p-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
