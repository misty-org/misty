import { cn, navigationMenuPrimaryLayoutClass } from "@/shared/ui";
import type { FramePacingState } from "@/application/layouts/model/types";

export const desktopFrameClass = [
  "relative isolate grid h-full min-h-0",
  "grid-rows-[36px_minmax(0,1fr)] overflow-hidden bg-charcoal-workspace text-cream",
].join(" ");

export const tabletFrameClass = [
  "relative isolate grid h-full min-h-0",
  "grid-rows-[minmax(0,1fr)] overflow-hidden bg-charcoal-workspace pb-6 pt-7 text-cream",
].join(" ");

export const desktopNavbarClass =
  "relative z-10 col-start-1 row-span-2 row-start-1 min-h-0 overflow-hidden";
export const tabletNavbarClass = "relative z-10 col-start-1 row-start-1 min-h-0 overflow-hidden";

// An auto-hiding navigator floats over the workspace instead of taking a grid
// column, so revealing it never reflows the surfaces underneath.
export const desktopFloatingNavbarClass =
  "absolute bottom-0 left-0 top-0 z-40 shadow-[0_18px_44px_rgba(0,0,0,0.6)]";
export const tabletFloatingNavbarClass =
  "absolute bottom-6 left-0 top-7 z-40 shadow-[0_18px_44px_rgba(0,0,0,0.6)]";
export const navigatorRevealStripClass = "absolute inset-y-0 left-0 z-30 w-3 cursor-pointer";

export const desktopRouteShellClass =
  "relative z-10 col-start-2 row-span-2 row-start-1 min-h-0 overflow-hidden bg-charcoal-bg";
export const tabletRouteShellClass =
  "relative z-10 col-start-2 row-start-1 min-h-0 overflow-hidden bg-charcoal-bg";

export const navbarGroupClass = [
  "flex w-full shrink-0 flex-col items-center gap-0.5 overflow-hidden px-1 pt-0",
].join(" ");

export const navbarSpacesClass = [
  "flex min-h-0 w-full flex-1 flex-col items-center overflow-x-hidden overflow-y-auto",
  "overscroll-contain px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
].join(" ");

export const navbarBottomClass = "mt-auto flex w-full shrink-0 flex-col items-center gap-0.5 px-1";

export const navItemBaseClass = [
  "misty-navbar-marker-side grid h-[66px] w-16 shrink-0 grid-rows-[44px_18px] place-items-center rounded-lg border-0 bg-transparent p-0",
  "text-cream-muted no-underline shadow-none transition-colors hover:text-cream-bright",
].join(" ");
export const navLinkBaseClass = navItemBaseClass;
// The current destination is marked by a line on the rail's edge rather than a
// filled tile, so the navbar reads as a rail with a pointer on it.
export const navLinkActiveClass = "text-cream-bright";
export const navButtonActiveClass = navLinkActiveClass;

export const navIconTileBaseClass =
  "relative grid h-11 w-12 place-items-center rounded-md text-current transition-colors";
export const navIconTileActiveClass = "text-cream-bright";
export const navIconClass = "size-6";

export const navItemLabelBaseClass =
  "block max-w-[60px] truncate text-center text-[10px] font-medium leading-tight text-current";
export const navItemLabelActiveClass = "text-cream-bright";

// Icon-only nav buttons keep a compact, consistent rail slot. The marker class
// lives on every item so hover and selection share the same edge animation.
export const navIconOnlyItemBaseClass = [
  "misty-navbar-marker-side grid h-[52px] w-14 shrink-0 place-items-center rounded-lg border-0 bg-transparent p-0",
  "text-cream-muted no-underline shadow-none transition-colors hover:text-cream-bright",
].join(" ");

export const profileDockClass = [
  "group/profile relative grid size-[50px] shrink-0 place-items-center rounded-full border-0 bg-transparent p-0",
  "text-cream-muted outline-none shadow-none transition-colors hover:bg-transparent",
  "focus-visible:ring-2 focus-visible:ring-charcoal-active",
].join(" ");

export const navigatorFocusRingClass = [
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted",
  "focus-visible:ring-offset-1 focus-visible:ring-offset-charcoal-workspace",
].join(" ");

export const navigatorPrimaryRowLayoutClass = navigationMenuPrimaryLayoutClass;

export const navigatorSubsectionIconClass =
  "misty-navigator-subsection-icon pointer-events-none grid size-6 shrink-0 place-items-center text-cream-bright [contain:layout_paint] [&_img]:!size-5 [&_svg]:!size-5";

// The account controls stay visually separate from the scrolling app list so
// they remain a stable, floating account island at the bottom of the rail.
export const navigatorFloatingIslandClass = [
  "flex items-center gap-1 rounded-xl border border-charcoal-border/60 bg-charcoal-card p-1",
  "shadow-[0_12px_30px_rgba(0,0,0,0.5)]",
].join(" ");

export const navigatorIslandActionClass = [
  "misty-navigator-icon-target grid size-9 shrink-0 place-items-center rounded-lg border-0 bg-transparent",
  "text-cream-muted no-underline outline-none transition-colors",
  "hover:bg-charcoal-active hover:text-cream-bright",
  navigatorFocusRingClass,
].join(" ");

export function navigatorRowClass(active: boolean): string {
  return cn(
    "misty-navigator-row-target relative h-9 w-full",
    navigatorPrimaryRowLayoutClass,
    "rounded-md border-0 bg-transparent px-2.5 text-sm text-cream-muted no-underline",
    "outline-none transition-colors",
    "hover:bg-charcoal-card hover:text-cream-bright",
    navigatorFocusRingClass,
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-cream-muted",
    active && "bg-charcoal-card text-cream-bright",
    active && "before:absolute before:h-6 before:w-0.5 before:rounded-r before:bg-sage-fg",
    active && "before:-left-3",
  );
}

export const profilePopoverClass = [
  "pointer-events-auto fixed z-[2147482900] grid max-h-[calc(100dvh-44px)] w-[286px] overflow-y-auto rounded-xl",
  "border border-charcoal-border bg-charcoal-card p-2 text-cream shadow-2xl",
].join(" ");

export const accountChooserPopoverClass = [
  "pointer-events-auto fixed z-[2147482910] grid max-h-[calc(100dvh-44px)] w-[320px] overflow-y-auto rounded-xl",
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
  "animate-in fade-in-0 slide-in-from-top-2 duration-160 ease-out",
].join(" ");

export const workStatusPulseClass = "size-2.5 rounded-full bg-status-green";
export const workStatusToastDurationMs = 3500;

// Where the top band's controls stop: traffic lights plus the shell's own
// buttons, with a gap. The dock header keeps its tabs to the right of this,
// minus whatever width the navigator rail already covers.
export const desktopTitlebarControlsEnd = 240;
export const windowsTitlebarControlsEnd = 264;
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

// Breathing room around the dock header's tab row, on every edge that is not
// already spoken for by the titlebar controls.
export const dockHeaderPadding = 8;

// The window's top band is 38px: tall enough that the strip above the dock
// tabs is a comfortable drag target. It stays click-through so the tabs
// underneath keep working; the rail strip and the dock header do the dragging.
export const desktopTitlebarClass =
  "group/titlebar pointer-events-none absolute inset-x-0 top-0 z-50 h-[38px] select-none";

// Empty band at the top of the rail: it lines the traffic lights up with the
// dock header and gives the whole left side back to window dragging.
export const navigatorTitlebarStripClass =
  "pointer-events-auto h-[38px] w-full shrink-0 select-none";

export const desktopWallpaperLayerClass = "hidden";

export const desktopTitlebarNavigationClass =
  "pointer-events-auto absolute top-0 z-[55] flex h-[38px] items-center gap-1";
export const desktopTitlebarNavigationButtonClass = [
  "grid size-6 place-items-center rounded-md border-0 bg-transparent p-0 text-cream-muted",
  "transition-colors hover:bg-charcoal-card hover:text-cream-bright",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active",
  "disabled:pointer-events-none disabled:text-cream-muted/35",
].join(" ");
export const windowsTitlebarControlsClass =
  "pointer-events-auto absolute right-0 top-0 z-[3] grid h-full grid-cols-3";

export const windowsWorkspaceControlsClass = "ml-auto flex h-7 shrink-0 items-center gap-0.5";

export const windowsTitlebarControlButtonClass =
  "grid h-full w-[46px] place-items-center border-0 bg-transparent p-0 text-cream-muted transition-colors hover:bg-charcoal-hover hover:text-cream";
export const windowsTitlebarCloseButtonClass = `${windowsTitlebarControlButtonClass} hover:bg-charcoal-active hover:text-cream-bright`;

export const frameOverlayBaseClass = [
  "pointer-events-none fixed right-3 top-10 z-[90] grid min-w-36 grid-cols-[minmax(0,1fr)_auto]",
  "gap-x-3 gap-y-[3px] rounded-md border bg-charcoal-card px-2.5 py-2 text-[11px] leading-tight",
  "text-cream shadow-xl",
].join(" ");

export const settingsOverlayLayerClass =
  "fixed inset-0 z-[2147482600] grid place-items-center bg-charcoal-workspace px-8 py-8";

export const settingsOverlayPanelClass = [
  "h-[min(760px,calc(100dvh-64px))] w-[min(980px,calc(100dvw-144px))]",
  "min-w-0 overflow-hidden rounded-2xl border border-charcoal-border bg-charcoal-card shadow-2xl",
].join(" ");

export const frameOverlayLevelClass: Record<FramePacingState["level"], string> = {
  idle: "border-status-green",
  light: "border-sage-fg",
  heavy: "border-charcoal-active",
};
