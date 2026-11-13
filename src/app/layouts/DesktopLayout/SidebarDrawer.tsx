import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { sidebarWidthMin, useSidebarWidthStore } from "@/app/shell/sidebarWidth";
import { useSidebarCollapsedStore } from "@/app/shell/sidebarCollapsed";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  enableModernWindowStyle,
  setTrafficLightsVisible,
  trafficLightGlyphDrop,
  trafficLightOffsetDefault,
  trafficLightRestY,
} from "@/native/runtime";
import {
  setBrowserPointerTrackingEnabled,
  setBrowserWebviewsSuspended,
} from "@/features/app-windows";
import { cn, Surface } from "@/shared/ui";
import { dockingMetrics } from "./dockingGeometry";

/** The sidebar header shares the Space bar's centerline, so the window buttons that sit on it drop
 * to that line whichever side the tabs are on. */
const lightsDrop =
  dockingMetrics.edge + dockingMetrics.spaceBar / 2 - trafficLightRestY + trafficLightGlyphDrop;
/** The first button's frame is 22pt from the window edge: 3pt right of the panel's content edge
 * (8 + 1 + 10 = 19pt), because the circle sits inside its frame, so the circle's edge lines up
 * with the address field's. */
const lightsInset = 2;

/** The reveal strip at the window edge, and how long the pointer may rest outside the drawer. */
const edgeZone = 8;
const hideDelayMs = 180;
/** How far past its narrowest the pointer must pull the drawer for it to close, in pixels. */
const sidebarCloseDistance = 70;

/**
 * Holds the sidebar. Open, it is a column beside the page. Collapsed, the column
 * animates shut and the sidebar waits at its window edge as a drawer, like an auto-hidden
 * navigator: moving the pointer to that edge slides it over the page, and leaving hides it.
 */
export function SidebarDrawer(props: { side: "left" | "right"; children: ReactNode }) {
  const collapsed = useSidebarCollapsedStore((state) => state.collapsed);
  const [revealed, setRevealed] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  const hidden = collapsed && !revealed;
  useEffect(() => {
    if (!collapsed) {
      setRevealed(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const contains = (element: HTMLElement | null, x: number, y: number) => {
      const bounds = element?.getBoundingClientRect();
      return Boolean(
        bounds && x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom,
      );
    };
    const heldOpen = () =>
      panel.current?.querySelector(
        ':focus-visible, [aria-haspopup][aria-expanded="true"], [aria-haspopup][data-state="open"]',
      );
    const move = (x: number, y: number) => {
      const bounds = wrapper.current?.getBoundingClientRect();
      if (!bounds) return;
      const onEdge =
        y >= bounds.top &&
        y < bounds.bottom &&
        (props.side === "left"
          ? x >= bounds.left && x < bounds.left + edgeZone
          : x <= bounds.right && x > bounds.right - edgeZone);
      if (onEdge) {
        clearTimeout(timer);
        timer = undefined;
        setRevealed(true);
      } else if (contains(panel.current, x, y) || heldOpen()) {
        clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          if (!heldOpen()) setRevealed(false);
        }, hideDelayMs);
      }
    };
    const pointer = (event: PointerEvent) => move(event.clientX, event.clientY);
    // Native pages swallow pointer events, so the host reports where the pointer is.
    const nativePointer = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (Number.isFinite(x) && Number.isFinite(y)) move(x, y);
    };
    window.addEventListener("pointermove", pointer);
    window.addEventListener("misty:browser-pointer", nativePointer);
    setBrowserPointerTrackingEnabled(true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("misty:browser-pointer", nativePointer);
      setBrowserPointerTrackingEnabled(false);
    };
  }, [collapsed, props.side]);

  // A revealed drawer sits over the page, so native pages step aside while it is out.
  useEffect(() => {
    setBrowserWebviewsSuspended(collapsed && revealed, "sidebar-reveal");
    return () => setBrowserWebviewsSuspended(false, "sidebar-reveal");
  }, [collapsed, revealed]);

  // The window buttons belong to the left sidebar: they start as its slide does and move with it,
  // and the first state is applied without motion.
  useEffect(() => {
    if (props.side !== "left" || !hasTauriInternals()) return;
    const nativeWindow = getCurrentWindow();
    void enableModernWindowStyle(nativeWindow, { x: lightsInset, y: lightsDrop }).catch(
      () => undefined,
    );
    return () =>
      void enableModernWindowStyle(nativeWindow, trafficLightOffsetDefault).catch(() => undefined);
  }, [props.side]);
  const lightsSettled = useRef(false);
  useLayoutEffect(() => {
    if (props.side !== "left" || !hasTauriInternals()) return;
    const distance = panel.current?.offsetWidth ?? 0;
    const duration = lightsSettled.current ? 300 : 0;
    lightsSettled.current = true;
    void setTrafficLightsVisible(!hidden, distance, duration).catch(() => undefined);
  }, [hidden, props.side]);
  useEffect(
    () => () => {
      if (props.side === "left" && hasTauriInternals())
        void setTrafficLightsVisible(true).catch(() => undefined);
    },
    [props.side],
  );

  const left = props.side === "left";
  // The window's own motion, so the drawer, the page and the window buttons move together.
  const motion =
    "duration-[var(--shell-motion-duration,300ms)] ease-[var(--shell-motion-easing,ease-in-out)]";
  return (
    <div
      ref={wrapper}
      className={cn(
        // A marker for useMergedTitlebar, which measures the sidebar by this holder.
        "misty-sidebar-drawer",
        // The width the person chose, whatever the window's. A sidebar that followed the window
        // would pull away from the native page during a live resize, since AppKit holds the page's
        // left edge until the window settles, and the gap would show the host behind it. Only a
        // sidebar too wide to leave the page 240px gives way. It goes as narrow as the person drags
        // it (sidebarWidth.ts).
        "[--sidebar-w:max(200px,min(var(--shell-side-tabs,280px),calc(100vw_-_240px)))]",
        "relative flex-none transition-[width]",
        motion,
        // Collapsed, the column animates shut and the panel waits off its edge.
        collapsed ? "w-0" : "w-[var(--sidebar-w)]",
        // While dragging the edge the width follows the pointer, with no easing.
        resizing && "transition-none",
      )}
      data-side={props.side}
      data-collapsed={collapsed || undefined}
      data-revealed={revealed || undefined}
      data-resizing={resizing || undefined}
      style={{ gridColumn: props.side === "right" ? 2 : 1, gridRow: "1 / -1" }}
    >
      {/* The strip above the page, across the whole window, moves the window. It is one row
          short of the page's top margin, so the page's top outline in that last row is not
          painted over, and it sits under the revealed drawer. */}
      <Surface
        tone="chrome"
        aria-hidden="true"
        className={cn(
          "absolute top-0 z-[var(--stack-above)] h-[calc(var(--pane-seam-top,8px)_-_1px)] w-screen",
          left ? "left-0" : "right-0",
        )}
        data-misty-window-titlebar-region="true"
      />
      {/* Revealed over the page, the panel keeps its chrome fill, so the sidebar always sits on
          the window color and nothing on the page shows through around it. The window edge pads
          its three outer sides. */}
      <Surface
        tone="chrome"
        floating={collapsed && revealed}
        ref={panel}
        className={cn(
          "absolute top-0 bottom-0 z-[var(--stack-overlay-raised)] flex w-[var(--sidebar-w)]",
          "py-[var(--pane-frame,6px)] transition-[transform,opacity]",
          motion,
          left ? "left-0 pl-[var(--pane-frame,6px)]" : "right-0 pr-[var(--pane-frame,6px)]",
          hidden &&
            cn(
              "pointer-events-none opacity-0",
              left ? "[transform:translateX(-100%)]" : "[transform:translateX(100%)]",
            ),
          collapsed && revealed && "overflow-hidden",
          resizing && "transition-none",
        )}
        aria-hidden={hidden || undefined}
        inert={hidden ? true : undefined}
      >
        {props.children}
      </Surface>
      {collapsed ? null : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          // The outer edge: a thin grab strip on the side away from the page.
          className={cn(
            "absolute top-0 bottom-0 z-[var(--stack-overlay-top)] w-2 cursor-col-resize touch-none",
            left ? "-right-1" : "-left-1",
          )}
          data-side={props.side}
          data-misty-window-drag-block="true"
          onDoubleClick={() => useSidebarWidthStore.getState().reset()}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const handle = event.currentTarget;
            handle.setPointerCapture(event.pointerId);
            const origin = wrapper.current?.getBoundingClientRect();
            if (!origin) return;
            setResizing(true);
            // Native pages step aside so they cannot swallow the drag.
            setBrowserWebviewsSuspended(true, "sidebar-resize");
            const move = (e: PointerEvent) => {
              const width =
                props.side === "left" ? e.clientX - origin.left : origin.right - e.clientX;
              // Pulled well past the narrowest it goes, in the closing direction, it closes.
              if (width < sidebarWidthMin - sidebarCloseDistance) {
                end();
                // The page steps aside while the drawer slides, as with the toggle button.
                setBrowserWebviewsSuspended(true, "sidebar-toggle");
                window.setTimeout(() => setBrowserWebviewsSuspended(false, "sidebar-toggle"), 340);
                if (!useSidebarCollapsedStore.getState().collapsed)
                  useSidebarCollapsedStore.getState().toggle();
                return;
              }
              useSidebarWidthStore.getState().set(width);
            };
            const end = () => {
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", end);
              handle.removeEventListener("pointercancel", end);
              setResizing(false);
              setBrowserWebviewsSuspended(false, "sidebar-resize");
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", end);
            handle.addEventListener("pointercancel", end);
          }}
        />
      )}
    </div>
  );
}
