import type { FramePacingState } from "@/models/types/layouts";

export const desktopFrameClass = [
  "relative isolate grid h-full min-h-0 grid-cols-[var(--misty-desktop-nav-width)_minmax(0,1fr)]",
  "grid-rows-[var(--misty-window-titlebar-inset)_minmax(0,1fr)] overflow-hidden",
  "bg-[var(--misty-app-frame-bg,var(--misty-bg))]",
].join(" ");
export const tabletFrameClass = [
  "relative isolate grid h-full min-h-0 grid-cols-[var(--misty-desktop-nav-width)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden",
  "bg-[var(--misty-app-frame-bg,var(--misty-bg))] pt-[max(var(--misty-safe-top),28px)]",
  "pb-[max(var(--misty-safe-bottom),24px)]",
].join(" ");

export const desktopNavbarClass =
  "relative z-10 col-start-1 row-start-2 flex min-h-0 flex-col items-center overflow-hidden pb-2 pt-0";
export const tabletNavbarClass =
  "relative z-10 col-start-1 row-start-1 flex min-h-0 flex-col items-center overflow-hidden pb-2 pt-0";

export const desktopRouteShellClass =
  "relative z-10 col-start-2 row-start-2 min-h-0 overflow-hidden bg-[var(--misty-app-route-bg,var(--misty-bg))]";
export const tabletRouteShellClass =
  "relative z-10 col-start-2 row-start-1 min-h-0 overflow-hidden bg-[var(--misty-app-route-bg,var(--misty-bg))]";

export const navbarGroupClass = [
  "flex min-h-0 w-full flex-1 flex-col items-center gap-3 overflow-x-hidden overflow-y-auto",
  "overscroll-contain pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
].join(" ");

export const navbarBottomClass = "mt-auto flex w-full shrink-0 flex-col items-center gap-4";

export const navItemBaseClass = [
  "grid h-[70px] w-full shrink-0 grid-rows-[50px_18px] place-items-center border-0 !bg-transparent p-0",
  "text-[var(--misty-text-muted)] no-underline shadow-none transition-colors hover:!bg-transparent",
  "hover:text-[var(--misty-text)] active:translate-y-0 aria-expanded:!bg-transparent",
].join(" ");
export const navLinkBaseClass = `misty-hover-marker-side misty-navbar-marker-side ${navItemBaseClass}`;
export const navLinkActiveClass = "misty-active-marker-side text-[var(--misty-text)]";
export const navButtonActiveClass = "text-[var(--misty-text)]";

export const navIconTileBaseClass = [
  "relative grid h-[50px] w-[54px] place-items-center rounded-[13px] text-[var(--misty-text)] transition-colors",
].join(" ");

export const navIconTileActiveClass = "text-[var(--misty-text)]";

export const navIconClass = "size-[27px]";

export const navItemLabelBaseClass = [
  "block max-w-[64px] truncate text-center text-[11px] font-semibold leading-[1.25]",
  "text-[var(--misty-text-subtle)] transition-colors group-hover/nav-item:text-[var(--misty-text-muted)]",
].join(" ");

export const navItemLabelActiveClass = "text-[var(--misty-text)]";

export const profileDockClass = [
  "relative grid h-[48px] w-[48px] shrink-0 place-items-center rounded-full border border-[var(--misty-border-soft)]",
  "bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] p-0 text-base font-bold text-[var(--misty-text)]",
  "transition hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))]",
].join(" ");

export const profilePopoverClass = [
  "fixed z-[2147482900] grid max-h-[calc(100dvh-var(--misty-window-titlebar-inset)-16px)] w-[286px] overflow-y-auto rounded-xl",
  "border border-[var(--misty-border-soft)] bg-popover",
  "p-2 text-[var(--misty-text)] shadow-[0_18px_52px_var(--misty-shadow)]",
].join(" ");

export const accountChooserPopoverClass = [
  "fixed z-[2147482910] grid max-h-[calc(100dvh-var(--misty-window-titlebar-inset)-16px)] w-[320px] overflow-y-auto rounded-xl",
  "border border-[var(--misty-border-soft)] bg-popover",
  "p-2 text-[var(--misty-text)] shadow-[0_18px_52px_var(--misty-shadow)]",
].join(" ");

export const profileMenuItemClass = [
  "grid min-h-10 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border-0 bg-transparent",
  "px-2.5 py-2 text-left text-sm text-[var(--misty-text-muted)]",
  "hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))] hover:text-[var(--misty-text)]",
].join(" ");

export const globalNoticeLayerClass =
  "pointer-events-none fixed left-1/2 top-[calc(var(--misty-window-titlebar-inset)+28px)] z-[2147482800] grid -translate-x-1/2 justify-items-center";

export const workStatusPopupClass = [
  "pointer-events-none fixed left-1/2 top-[calc(var(--misty-window-titlebar-inset)+16px)] z-[2147482850] grid",
  "max-w-[min(360px,calc(100vw-96px))] -translate-x-1/2 grid-cols-[10px_minmax(0,1fr)] items-center",
  "gap-3 rounded-lg border border-border bg-popover/95 px-3.5 py-2.5 text-sm text-popover-foreground",
  "shadow-[0_18px_48px_var(--misty-shadow)] ring-1 ring-foreground/10 backdrop-blur-xl",
].join(" ");

export const workStatusPulseClass =
  "size-2.5 rounded-full bg-[var(--misty-success)] shadow-[0_0_18px_color-mix(in_srgb,var(--misty-success)_72%,transparent)]";
export const workStatusToastDurationMs = 3500;

export const desktopTitlebarClass =
  "group/titlebar relative z-10 col-span-full row-start-1 h-full select-none border-b border-transparent bg-[var(--misty-app-titlebar-bg,var(--misty-bg))]";

export const desktopWallpaperLayerClass =
  "pointer-events-none absolute inset-0 z-0 col-span-full row-span-full overflow-hidden";

export const desktopTitlebarTitleClass = [
  "pointer-events-none absolute inset-x-[112px] top-0 flex h-full min-w-0 items-center justify-center truncate",
  "text-[13px] font-semibold leading-none text-[var(--misty-text-muted)]",
].join(" ");

// Windows/Linux have no left-side traffic lights, so the centered inset leaves a
// dead gap in the top-left. Left-align the title there instead (native Windows
// style), leaving room on the right for the caption buttons.
export const windowsTitlebarTitleClass = [
  "pointer-events-none absolute inset-y-0 left-3.5 right-[152px] flex min-w-0 items-center justify-start truncate",
  "text-[13px] font-semibold leading-none text-[var(--misty-text-muted)]",
].join(" ");

export const desktopTitlebarDoubleClickLayerClass = "absolute inset-0 cursor-default";

export const windowsTitlebarControlsClass = "absolute right-0 top-0 z-[3] grid h-full grid-cols-3";

export const windowsTitlebarControlButtonClass = [
  "grid h-full w-[46px] place-items-center border-0 bg-transparent p-0 text-[var(--misty-text-muted)] transition",
  "hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))] hover:text-[var(--misty-text)]",
].join(" ");

export const windowsTitlebarCloseButtonClass = `${windowsTitlebarControlButtonClass} hover:bg-[#c42b1c] hover:text-white`;

export const frameOverlayBaseClass = [
  "pointer-events-none fixed right-3 top-[calc(var(--misty-window-titlebar-inset)+10px)] z-[90] grid min-w-36",
  "grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-[3px] rounded-[7px] border",
  "bg-[color-mix(in_srgb,var(--misty-bg)_88%,transparent)] px-2.5 py-2 text-[11px] leading-[1.2]",
  "text-[var(--misty-text)] shadow-[0_12px_34px_var(--misty-shadow)]",
].join(" ");

export const settingsOverlayLayerClass = [
  "fixed inset-0 z-[2147482600] grid place-items-center bg-transparent py-8 pr-8",
  "pl-[calc(var(--misty-desktop-nav-width)+2rem)] backdrop-blur-[8px]",
].join(" ");

export const settingsOverlayPanelClass = [
  "h-[min(760px,calc(100dvh-var(--misty-window-titlebar-inset)-64px))]",
  "w-[min(980px,calc(100dvw-var(--misty-desktop-nav-width)-64px))]",
  "min-w-0 overflow-hidden rounded-2xl",
  "border border-border bg-[var(--misty-app-modal-bg,var(--popover))]",
  "shadow-[0_28px_90px_rgba(0,0,0,0.62)] backdrop-blur-xl",
].join(" ");

export const frameOverlayLevelClass: Record<FramePacingState["level"], string> = {
  idle: "border-[color-mix(in_srgb,var(--misty-success)_45%,var(--misty-border-soft))]",
  light: "border-[color-mix(in_srgb,var(--misty-warning)_52%,var(--misty-border-soft))]",
  heavy: "border-[color-mix(in_srgb,var(--misty-danger)_58%,var(--misty-border-soft))]",
};
