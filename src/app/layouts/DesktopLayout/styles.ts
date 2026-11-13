import type { FramePacingState } from "@/app/layouts/desktop-state";
import type { SurfaceEdge } from "@/shared/ui";

// The drawer, tab inset, and titlebar controls must move on the same timeline.
export const navigatorMotionClass =
  "duration-[var(--shell-motion-duration,300ms)] ease-[var(--shell-motion-easing,ease-in-out)] motion-reduce:transition-none";

/**
 * A 16px slot for a row's icon or an agent's mark (sidebar rows, search hits). An agent's mark
 * stands alone at icon size, with no disc behind it; it outranks AgentAvatar's own sizes.
 */
export const markSlotClass = [
  "grid size-4 flex-none place-items-center",
  "[&>.agent-avatar]:!size-4 [&>.agent-avatar]:!bg-transparent [&>.agent-avatar]:!text-caption",
].join(" ");

/** A group of the sidebar's chats: its heading, then its rows, which keep a visible gap so a
 * hovered row never runs into the current one. */
export const chatSectionClass = "flex flex-none flex-col gap-1";

export const profileDockClass = [
  "group/profile relative grid size-12 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0",
  "outline-none shadow-none transition-colors hover:bg-transparent",
].join(" ");

export const desktopTitlebarNavigationInset = 84;
/** Three 36px caption buttons, before they are measured. */
export const windowsTitlebarControlsFallbackWidth = 108;

export function desktopTitlebarNavigationGeometry(
  appZoom: number,
  inset = desktopTitlebarNavigationInset,
): {
  left: number;
  scale: number;
} {
  const zoom = Number.isFinite(appZoom) && appZoom > 0 ? appZoom : 1;
  return {
    left: inset / zoom,
    scale: 1 / zoom,
  };
}

/** Beside a vertical sidebar the caption buttons share its header row, which starts below the
 * pane margin and the card's border; they are centred on that row's 40px. */
export const windowsTitlebarControlsClass =
  "misty-windows-caption-controls pointer-events-auto absolute left-0 top-[calc(var(--pane-frame,6px)+1px)] z-[3] flex h-10 w-max flex-nowrap items-center";

export const windowsTitlebarControlButtonClass =
  "grid h-full w-9 shrink-0 place-items-center border-0 bg-transparent p-0 transition-colors";
/** Signed-out pages have no sidebar: minimize, maximize and close sit in the usual top-right corner. */
export const windowsStandardControlsClass =
  "misty-windows-standard-controls pointer-events-auto absolute right-0 top-0 z-[3] flex h-9 w-max flex-nowrap items-center";
export const windowsStandardControlButtonClass =
  "grid h-9 w-12 shrink-0 place-items-center border-0 bg-transparent p-0 transition-colors";
/** The same buttons seated in the sidebar's header row, sized like the icons beside them. */
export const windowsInlineControlsClass = "mr-1 flex shrink-0 items-center gap-0.5";
export const windowsInlineControlButtonClass =
  "grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 transition-colors";

export const frameOverlayBaseClass = [
  "pointer-events-none fixed right-3 top-10 z-[90] grid min-w-36 grid-cols-[minmax(0,1fr)_auto]",
  "gap-x-3 gap-y-1 px-2.5 py-2 text-2xs leading-tight shadow-xl",
].join(" ");

/** The overlay's edge: the hairline while idle, the strong edge once frames start to slip. */
export const frameOverlayLevelEdge: Record<FramePacingState["level"], SurfaceEdge> = {
  idle: "hairline",
  light: "strong",
  heavy: "strong",
};
