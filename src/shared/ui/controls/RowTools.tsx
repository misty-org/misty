import type { ReactNode } from "react";
import { cn } from "../classNames";
import { Surface } from "../display/Surface";
import { RowControls } from "./rowContext";

/**
 * When a row's tools show:
 * - `always`: in place, at the row's end.
 * - `hover`: only while the pointer is over the row or focus is in it (or one's menu is open);
 *   they take room from the name while shown.
 * - `cover`: like hover, but drawn over the row's end on the hovered row's own fill, so the name
 *   keeps the whole width (a path in a list of changes).
 */
export type RowToolsReveal = "always" | "hover" | "cover";

const revealClass: Record<Exclude<RowToolsReveal, "cover">, string> = {
  always: "flex",
  hover: cn(
    "hidden group-hover/row:flex group-focus-within/row:flex",
    "group-has-[[data-state=open]]/row:flex",
  ),
};

/**
 * A row's own buttons, at its end, as one tight group: IconButtons 24px, 2px apart, so the row's
 * 4px inset shows around them and no gap opens between icons. The row is a `group/row`.
 *
 * ```tsx
 * <RowTools reveal="hover">
 *   <IconButton label="Refresh" onClick={refresh}><RotateCw /></IconButton>
 *   <IconButton label="Add to chat" onClick={mention}><Plus /></IconButton>
 * </RowTools>
 * ```
 */
export function RowTools({
  reveal = "always",
  children,
}: {
  reveal?: RowToolsReveal;
  children: ReactNode;
}) {
  if (reveal === "cover")
    return (
      // Over the row's end: the panel's fill under the hovered row's wash, so it sits on the row
      // unseen; the row must be `relative`.
      <Surface
        tone="sidebar"
        data-slot="row-tools"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-1 flex opacity-0",
          "group-hover/row:pointer-events-auto group-hover/row:opacity-100",
          "group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
          "has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100",
        )}
      >
        <Surface tone="faint" className="flex items-center gap-0.5 pl-3">
          <RowControls>{children}</RowControls>
        </Surface>
      </Surface>
    );
  return (
    <span
      data-slot="row-tools"
      className={cn("flex-none items-center gap-0.5", revealClass[reveal])}
    >
      <RowControls>{children}</RowControls>
    </span>
  );
}
