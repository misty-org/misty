import type { FramePacingState } from "@/models/types/layouts";

export const desktopFrameClass = [
  "relative isolate grid h-full min-h-0 grid-cols-[80px_minmax(0,1fr)]",
  "grid-rows-[28px_minmax(0,1fr)] overflow-hidden bg-charcoal-workspace text-cream",
].join(" ");

export const tabletFrameClass = [
  "relative isolate grid h-full min-h-0 grid-cols-[80px_minmax(0,1fr)]",
  "grid-rows-[minmax(0,1fr)] overflow-hidden bg-charcoal-workspace pb-6 pt-7 text-cream",
].join(" ");

export const desktopNavbarClass =
  "relative z-10 col-start-1 row-start-2 flex min-h-0 flex-col items-center overflow-hidden border-r border-charcoal-border bg-charcoal-workspace pb-2";
export const tabletNavbarClass =
  "relative z-10 col-start-1 row-start-1 flex min-h-0 flex-col items-center overflow-hidden border-r border-charcoal-border bg-charcoal-workspace pb-2";

export const desktopRouteShellClass =
  "relative z-10 col-start-2 row-start-2 min-h-0 overflow-hidden bg-charcoal-bg";
export const tabletRouteShellClass =
  "relative z-10 col-start-2 row-start-1 min-h-0 overflow-hidden bg-charcoal-bg";

export const navbarGroupClass = [
  "flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto",
  "overscroll-contain px-2 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
].join(" ");

export const navbarBottomClass = "mt-auto flex w-full shrink-0 flex-col items-center gap-2 px-2";

export const navItemBaseClass = [
  "grid h-[66px] w-16 shrink-0 grid-rows-[44px_18px] place-items-center rounded-lg border-0 bg-transparent p-0",
  "text-cream-muted no-underline shadow-none transition-colors hover:text-cream-bright",
].join(" ");
export const navLinkBaseClass = navItemBaseClass;
// The current destination is marked by a line on the rail's edge rather than a
// filled tile, so the navbar reads as a rail with a pointer on it.
export const navLinkActiveClass = "misty-navbar-marker-side text-cream-bright";
export const navButtonActiveClass = navLinkActiveClass;

export const navIconTileBaseClass =
  "relative grid h-11 w-12 place-items-center rounded-md text-current transition-colors";
export const navIconTileActiveClass = "text-cream-bright";
export const navIconClass = "size-6";

export const navItemLabelBaseClass =
  "block max-w-[60px] truncate text-center text-[10px] font-medium leading-tight text-current";
export const navItemLabelActiveClass = "text-cream-bright";

// Icon-only nav buttons (no label row) still occupy the full 66px rail slot
// so they line up with the labeled items above them.
export const navIconOnlyItemBaseClass = [
  "grid h-[66px] w-16 shrink-0 place-items-center rounded-lg border-0 bg-transparent p-0",
  "text-cream-muted no-underline shadow-none transition-colors hover:text-cream-bright",
].join(" ");

export const profileDockClass = [
  "group/profile relative grid size-[50px] shrink-0 place-items-center rounded-full border-0 bg-transparent p-0",
  "text-cream-muted outline-none shadow-none transition-colors hover:bg-transparent",
  "focus-visible:ring-2 focus-visible:ring-charcoal-active",
].join(" ");

export const profilePopoverClass = [
  "fixed z-[2147482900] grid max-h-[calc(100dvh-44px)] w-[286px] overflow-y-auto rounded-xl",
  "border border-charcoal-border bg-charcoal-card p-2 text-cream shadow-2xl",
].join(" ");

export const accountChooserPopoverClass = [
  "fixed z-[2147482910] grid max-h-[calc(100dvh-44px)] w-[320px] overflow-y-auto rounded-xl",
  "border border-charcoal-border bg-charcoal-card p-2 text-cream shadow-2xl",
].join(" ");

export const profileMenuItemClass = [
  "grid min-h-10 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border-0 bg-transparent",
  "px-2.5 py-2 text-left text-sm text-cream-muted transition-colors",
  "hover:text-cream-bright",
].join(" ");

export const globalNoticeLayerClass =
  "pointer-events-none fixed left-1/2 top-14 z-[2147482800] grid -translate-x-1/2 justify-items-center";

export const workStatusPopupClass = [
  "pointer-events-none fixed left-1/2 top-11 z-[2147482850] grid max-w-[min(360px,calc(100vw-96px))]",
  "-translate-x-1/2 grid-cols-[10px_minmax(0,1fr)] items-center gap-3 rounded-lg border",
  "border-charcoal-border bg-charcoal-card px-3.5 py-2.5 text-sm text-cream shadow-xl",
].join(" ");

export const workStatusPulseClass = "size-2.5 rounded-full bg-status-green";
export const workStatusToastDurationMs = 3500;

export const desktopTitlebarClass =
  "group/titlebar relative z-10 col-span-full row-start-1 h-full select-none border-b border-charcoal-border bg-charcoal-workspace";

export const desktopWallpaperLayerClass = "hidden";

export const desktopTitlebarTitleClass =
  "pointer-events-none absolute inset-x-28 top-0 flex h-full min-w-0 items-center justify-center truncate text-[13px] font-medium leading-none text-cream-muted";

export const windowsTitlebarTitleClass =
  "pointer-events-none absolute inset-y-0 left-3.5 right-[152px] flex min-w-0 items-center justify-start truncate text-[13px] font-medium leading-none text-cream-muted";

export const desktopTitlebarDoubleClickLayerClass = "absolute inset-0 cursor-default";
export const windowsTitlebarControlsClass = "absolute right-0 top-0 z-[3] grid h-full grid-cols-3";

export const windowsTitlebarControlButtonClass =
  "grid h-full w-[46px] place-items-center border-0 bg-transparent p-0 text-cream-muted transition-colors hover:bg-charcoal-hover hover:text-cream";
export const windowsTitlebarCloseButtonClass = `${windowsTitlebarControlButtonClass} hover:bg-charcoal-active hover:text-cream-bright`;

export const frameOverlayBaseClass = [
  "pointer-events-none fixed right-3 top-10 z-[90] grid min-w-36 grid-cols-[minmax(0,1fr)_auto]",
  "gap-x-3 gap-y-[3px] rounded-md border bg-charcoal-card px-2.5 py-2 text-[11px] leading-tight",
  "text-cream shadow-xl",
].join(" ");

export const settingsOverlayLayerClass =
  "fixed inset-0 z-[2147482600] grid place-items-center bg-charcoal-workspace py-8 pl-28 pr-8";

export const settingsOverlayPanelClass = [
  "h-[min(760px,calc(100dvh-64px))] w-[min(980px,calc(100dvw-144px))]",
  "min-w-0 overflow-hidden rounded-2xl border border-charcoal-border bg-charcoal-card shadow-2xl",
].join(" ");

export const frameOverlayLevelClass: Record<FramePacingState["level"], string> = {
  idle: "border-status-green",
  light: "border-sage-fg",
  heavy: "border-charcoal-active",
};
