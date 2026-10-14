import { useEffect, useRef, useState, type ReactNode } from "react";
import { sidebarWidthMin, useSidebarWidthStore } from "@/features/app-shell/sidebarWidth";
import { useSidebarCollapsedStore } from "@/features/app-shell/sidebarCollapsed";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  enableModernWindowStyle,
  setTrafficLightsVisible,
  trafficLightOffsetDefault,
} from "@/native/runtime";
import {
  setBrowserPointerTrackingEnabled,
  setBrowserWebviewsSuspended,
} from "@/features/webviews/browserRuntime";

/** The sidebar header is 40pt tall inside the panel's 8pt margin, so the window buttons that sit
 * on it drop to its centerline: 8 + 1 + 20 = 29pt, 10 below their usual 19. */
const lightsDrop = 10;
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
 * Holds the vertical tab sidebar. Open, it is a column beside the page. Collapsed, the column
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

  // The window buttons belong to the left sidebar: they slide out and back in with it, and
  // the first state is applied without motion.
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
  useEffect(() => {
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

  return (
    <div
      ref={wrapper}
      className="misty-sidebar-drawer"
      data-side={props.side}
      data-collapsed={collapsed || undefined}
      data-revealed={revealed || undefined}
      data-resizing={resizing || undefined}
      style={{ order: props.side === "right" ? 2 : 0 }}
    >
      {/* The strip above the page, across the whole window, moves the window. */}
      <div
        aria-hidden="true"
        className="misty-sidebar-drag-band"
        data-misty-window-titlebar-region="true"
      />
      <div
        ref={panel}
        className="misty-sidebar-drawer-panel"
        aria-hidden={hidden || undefined}
        inert={hidden ? true : undefined}
      >
        {props.children}
      </div>
      {collapsed ? null : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="misty-sidebar-resize"
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
