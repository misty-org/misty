import type { ReactNode } from "react";

/**
 * The bar along the top of an overlay or a popup, the twin of `BottomBar`: the header's height
 * (48px) on the surface's own background, so its controls (a close button, last) have a band of
 * their own and the content scrolls beneath it instead of under them. `start` holds anything that
 * belongs at its other end, such as a title.
 *
 * ```tsx
 * <TopBar aria-label="Settings">
 *   <IconButton label="Close settings" onClick={close}><X /></IconButton>
 * </TopBar>
 * ```
 */
export function TopBar(props: { children?: ReactNode; start?: ReactNode; "aria-label"?: string }) {
  return (
    <header
      data-slot="top-bar"
      aria-label={props["aria-label"]}
      className="flex h-(--ui-header) min-w-0 shrink-0 items-center gap-2 px-3"
    >
      {props.start ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">{props.start}</div>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">{props.children}</div>
    </header>
  );
}
