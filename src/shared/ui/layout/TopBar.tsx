import type { ReactNode } from "react";
import { cn } from "../classNames";

/**
 * The bar along the top of an overlay or a popup, the twin of `BottomBar`: the header's height
 * (`--ui-header`) on the surface's own background, so its controls (a close button, last) have a
 * band of their own and the content scrolls beneath it instead of under them. `start` holds
 * anything that belongs at its other end, such as a title. `divider` draws a page header's
 * hairline under it, so a bar the content scrolls beneath reads as staying put, and adds 4px
 * above and below so what it holds centers between the edge and that line.
 *
 * ```tsx
 * <TopBar aria-label="Settings" divider>
 *   <IconButton label="Close settings" onClick={close}><X /></IconButton>
 * </TopBar>
 * ```
 */
export function TopBar(props: {
  children?: ReactNode;
  start?: ReactNode;
  divider?: boolean;
  "aria-label"?: string;
}) {
  return (
    <header
      data-slot="top-bar"
      aria-label={props["aria-label"]}
      className={cn(
        "flex h-(--ui-header) min-w-0 shrink-0 items-center gap-2 px-3",
        // Divided, it gets a step of room above and below, so its controls center between the
        // surface's edge and the line.
        props.divider && "box-content border-b border-charcoal-border py-1",
      )}
    >
      {props.start ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">{props.start}</div>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">{props.children}</div>
    </header>
  );
}
