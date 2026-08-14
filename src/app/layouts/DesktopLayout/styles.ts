import type { FramePacingState } from "@/app/layouts/model/types";

// The drawer, tab inset, and titlebar controls must move on the same timeline.
export const navigatorMotionClass = "misty-shell-motion motion-reduce:transition-none";

export const profileDockClass = [
  "group/profile relative grid size-[50px] shrink-0 place-items-center rounded-full border-0 bg-transparent p-0",
  "text-cream-muted outline-none shadow-none transition-colors hover:bg-transparent",
  "focus-visible:ring-2 focus-visible:ring-charcoal-active",
].join(" ");

export const navigatorFocusRingClass = [
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted",
  "focus-visible:ring-offset-1 focus-visible:ring-offset-charcoal-workspace",
].join(" ");

export const navigatorIslandActionClass = [
  "misty-navigator-icon-target grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent p-0",
  "text-cream-muted no-underline outline-none transition-colors",
  "hover:bg-control-hover hover:text-cream",
  "aria-pressed:bg-control-active aria-pressed:text-cream data-[state=open]:bg-control-active",
  navigatorFocusRingClass,
].join(" ");

export const navigatorHeaderRowClass = "flex min-w-0 items-center py-0.5";

export const navigatorHierarchyActionClass = navigatorIslandActionClass;

export const workStatusToastDurationMs = 3500;
export const desktopTitlebarNavigationInset = 84;
export const windowsTitlebarNavigationInset = 8;

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
  "pointer-events-auto absolute right-0 top-0 z-[3] flex h-full w-max flex-nowrap items-center";

export const windowsWorkspaceControlsClass =
  "mx-2 flex h-7 shrink-0 flex-nowrap items-center gap-1 empty:hidden";

export const windowsTitlebarControlButtonClass =
  "grid h-full w-[46px] shrink-0 place-items-center border-0 bg-transparent p-0 text-cream-muted transition-colors hover:bg-charcoal-hover hover:text-cream";
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
