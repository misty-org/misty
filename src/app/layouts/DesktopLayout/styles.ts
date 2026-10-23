import type { FramePacingState } from "@/app/layouts/model";

// The drawer, tab inset, and titlebar controls must move on the same timeline.
export const navigatorMotionClass = "misty-shell-motion motion-reduce:transition-none";

export const profileDockClass = [
  "group/profile relative grid size-[50px] shrink-0 place-items-center rounded-full border-0 bg-transparent p-0",
  "text-cream-muted outline-none shadow-none transition-colors hover:bg-transparent",
  "focus-visible:ring-2 focus-visible:ring-charcoal-active",
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

export const windowsTitlebarControlsClass =
  "misty-windows-caption-controls pointer-events-auto absolute left-0 top-0 z-[3] flex h-full w-max flex-nowrap items-center";

export const windowsTitlebarControlButtonClass =
  "grid h-full w-[36px] shrink-0 place-items-center border-0 bg-transparent p-0 text-cream-muted transition-colors hover:bg-charcoal-hover hover:text-cream";
/** Signed-out pages have no sidebar: minimize, maximize and close sit in the usual top-right corner. */
export const windowsStandardControlsClass =
  "misty-windows-standard-controls pointer-events-auto absolute right-0 top-0 z-[3] flex h-9 w-max flex-nowrap items-center";
export const windowsStandardControlButtonClass =
  "grid h-9 w-[46px] shrink-0 place-items-center border-0 bg-transparent p-0 text-cream-muted transition-colors hover:bg-charcoal-hover hover:text-cream";
/** The same buttons seated in the sidebar's header row, sized like the icons beside them. */
export const windowsInlineControlsClass = "mr-1 flex shrink-0 items-center gap-0.5";
export const windowsInlineControlButtonClass =
  "grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-cream-muted transition-colors hover:bg-charcoal-hover hover:text-cream";
export const windowsTitlebarCloseButtonClass = `${windowsTitlebarControlButtonClass} hover:bg-charcoal-active hover:text-cream-bright`;

export const frameOverlayBaseClass = [
  "pointer-events-none fixed right-3 top-10 z-[90] grid min-w-36 grid-cols-[minmax(0,1fr)_auto]",
  "gap-x-3 gap-y-[3px] rounded-md border bg-charcoal-card px-2.5 py-2 text-[11px] leading-tight",
  "text-cream shadow-xl",
].join(" ");

export const frameOverlayLevelClass: Record<FramePacingState["level"], string> = {
  idle: "border-status-green",
  light: "border-sage-fg",
  heavy: "border-charcoal-active",
};
