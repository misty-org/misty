import type { FramePacingState } from "@/app/layouts/desktop-state";
import type { SurfaceEdge } from "@misty/ui";

export const navigatorMotionClass =
  "duration-[var(--shell-motion-duration,300ms)] ease-[var(--shell-motion-easing,ease-in-out)] motion-reduce:transition-none";

export const markSlotClass = [
  "grid size-4 flex-none place-items-center",
  "[&>.agent-avatar]:!size-4 [&>.agent-avatar]:!bg-transparent [&>.agent-avatar]:!text-caption",
].join(" ");

export const faceSlotClass = "grid size-6 flex-none place-items-center";

export const chatSectionClass = "flex flex-none flex-col gap-1.5";

export const profileDockClass = [
  "group/profile relative grid size-12 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0",
  "outline-none shadow-none transition-colors hover:bg-transparent",
].join(" ");

export const desktopTitlebarNavigationInset = 84;
export const windowsTitlebarControlsFallbackWidth = 138;

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

export const windowsStandardControlsClass = [
  "misty-windows-standard-controls pointer-events-auto absolute right-0 top-0 z-[3] flex",
  "h-[var(--shell-titlebar,calc(var(--spacing)*9.5))] w-max flex-nowrap items-stretch",
].join(" ");
export const windowsStandardControlButtonClass =
  "grid w-11.5 shrink-0 place-items-center rounded-none border-0 bg-transparent p-0 transition-colors";
export const windowsCloseControlButtonClass = [
  windowsStandardControlButtonClass,
  "hover:bg-window-close hover:text-white active:bg-window-close/90 active:text-white",
].join(" ");
export const windowsInlineControlsClass = "ml-1 flex shrink-0 items-center gap-0.5";
export const windowsInlineControlButtonClass =
  "grid h-8 w-10 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 transition-colors";
export const windowsInlineCloseButtonClass = [
  windowsInlineControlButtonClass,
  "hover:bg-window-close hover:text-white active:bg-window-close/90 active:text-white",
].join(" ");
export const windowsSystemGlyphClass =
  "font-['Segoe_Fluent_Icons','Segoe_MDL2_Assets'] text-window-glyph leading-none font-normal";

export const frameOverlayBaseClass = [
  "pointer-events-none fixed right-3 top-10 z-[90] grid min-w-36 grid-cols-[minmax(0,1fr)_auto]",
  "gap-x-3 gap-y-1 px-2.5 py-2 text-micro leading-tight",
].join(" ");

export const frameOverlayLevelEdge: Record<FramePacingState["level"], SurfaceEdge> = {
  idle: "hairline",
  light: "strong",
  heavy: "strong",
};
