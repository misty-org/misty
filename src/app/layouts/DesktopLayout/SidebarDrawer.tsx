import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { sidebarWidthMin, useSidebarWidthStore } from "@/app/shell/sidebar_width";
import { useSidebarCollapsedStore } from "@/app/shell/sidebar_collapsed";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  enableModernWindowStyle,
  setTrafficLightsVisible,
  trafficLightOffsetDefault,
  trafficLightRestY,
} from "@/native/runtime";
import {
  setBrowserPointerTrackingEnabled,
  setBrowserWebviewsSuspended,
} from "@/features/app-windows";
import { cn, Separator, Surface } from "@misty/ui";
import { designPx, uiPx } from "@misty/ui";
import { dockingMetrics } from "./docking_geometry";

const lightsDrop = () =>
  uiPx(dockingMetrics.edge + dockingMetrics.spaceBar / 2) - trafficLightRestY;
const lightsInset = 2;

const edgeZone = 8;
const hideDelayMs = 180;
const sidebarCloseDistance = 70;

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

  useEffect(() => {
    setBrowserWebviewsSuspended(collapsed && revealed, "sidebar-reveal");
    return () => setBrowserWebviewsSuspended(false, "sidebar-reveal");
  }, [collapsed, revealed]);

  useEffect(() => {
    if (props.side !== "left" || !hasTauriInternals()) return;
    const nativeWindow = getCurrentWindow();
    void enableModernWindowStyle(nativeWindow, { x: lightsInset, y: lightsDrop() }).catch(
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
  const motion =
    "duration-[var(--shell-motion-duration,300ms)] ease-[var(--shell-motion-easing,ease-in-out)]";
  return (
    <div
      ref={wrapper}
      className={cn(
        "misty-sidebar-drawer",
        "[--sidebar-w:max(calc(var(--spacing)_*_70),min(var(--shell-side-tabs,calc(var(--spacing)*70)),calc(100vw_-_var(--spacing)_*_60)))]",
        "relative flex-none transition-[width]",
        motion,
        collapsed ? "w-0" : "w-[var(--sidebar-w)]",
        resizing && "transition-none",
      )}
      data-side={props.side}
      data-collapsed={collapsed || undefined}
      data-revealed={revealed || undefined}
      data-resizing={resizing || undefined}
      style={{ gridColumn: props.side === "right" ? 2 : 1, gridRow: "1 / -1" }}
    >
      <Surface
        tone="chrome"
        aria-hidden="true"
        className={cn(
          "absolute top-0 z-[var(--stack-above)] h-[calc(var(--pane-seam-top,calc(var(--spacing)*2))_-_1px)] w-screen",
          left ? "left-0" : "right-0",
        )}
        data-misty-window-titlebar-region="true"
      />
      <Surface
        tone="chrome"
        floating={collapsed && revealed}
        ref={panel}
        className={cn(
          "absolute top-0 bottom-0 z-[var(--stack-overlay-raised)] flex w-[var(--sidebar-w)]",
          "py-[var(--pane-frame,calc(var(--spacing)*1.5))] transition-[transform,opacity]",
          motion,
          left
            ? "left-0 pl-[var(--pane-frame,calc(var(--spacing)*1.5))]"
            : "right-0 pr-[var(--pane-frame,calc(var(--spacing)*1.5))]",
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
        <Separator
          orientation="vertical"
          className={cn(
            "pointer-events-none absolute top-0 bottom-0 z-[var(--stack-overlay-raised)]",
            left ? "right-0" : "left-0",
          )}
        />
      )}
      {collapsed ? null : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
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
            setBrowserWebviewsSuspended(true, "sidebar-resize");
            const move = (e: PointerEvent) => {
              const width = designPx(
                props.side === "left" ? e.clientX - origin.left : origin.right - e.clientX,
              );
              if (width < sidebarWidthMin - sidebarCloseDistance) {
                end();
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
