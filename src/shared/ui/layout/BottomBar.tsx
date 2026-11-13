import type { ReactNode } from "react";

/**
 * The bar along the bottom of the window, a popup or an overlay, which keeps room there so nothing
 * floats over the content. It mirrors a top bar: the header's height (48px) with its controls
 * centered in it, 12px in from the right, the "i" for the surface's tour last. `start` holds
 * anything that belongs at its other end.
 *
 * ```tsx
 * <BottomBar aria-label="Help">
 *   <TourInfoButton tour="help" />
 * </BottomBar>
 * ```
 */
export function BottomBar(props: {
  children?: ReactNode;
  start?: ReactNode;
  "aria-label"?: string;
  "data-tour"?: string;
}) {
  return (
    <footer
      data-slot="bottom-bar"
      aria-label={props["aria-label"]}
      data-tour={props["data-tour"]}
      className="flex h-(--ui-header) min-w-0 shrink-0 items-center gap-2 px-3"
    >
      {props.start ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">{props.start}</div>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">{props.children}</div>
    </footer>
  );
}
