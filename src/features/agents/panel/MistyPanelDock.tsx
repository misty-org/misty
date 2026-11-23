import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { cn, Surface } from "@misty/ui";
import { designPx, remCss } from "@misty/ui";
import type { MistyPanelSide } from "./misty_panel_side";
import {
  MISTY_PANEL_MAX_WIDTH,
  MISTY_PANEL_MIN_WIDTH,
  MISTY_PANEL_WIDTH,
  useMistyPanelStore,
  type MistyPanelView,
} from "./misty_panel_store";

const slideMs = 240;

const panelGap = 6;

const closeDistance = 70;

const geometryChanged = () => window.dispatchEvent(new Event("misty:workspace-geometry-changed"));

function useEdgeDrag(reason: string) {
  const [dragging, setDragging] = useState(false);
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);
  const start = (
    event: PointerEvent<HTMLDivElement>,
    move: (next: globalThis.PointerEvent, end: () => void) => void,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const follow = (next: globalThis.PointerEvent) => move(next, end);
    const root = document.documentElement.style;
    function end() {
      root.cursor = "";
      root.userSelect = "";
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      stop.current = undefined;
      setDragging(false);
      setBrowserWebviewsSuspended(false, reason);
      geometryChanged();
    }
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    stop.current = end;
    root.cursor = "col-resize";
    root.userSelect = "none";
    setDragging(true);
    setBrowserWebviewsSuspended(true, reason);
  };
  return { dragging, start };
}

export function MistyPanelDock({
  views,
  side,
  chat,
}: {
  views: MistyPanelView[];
  side: MistyPanelSide;
  chat?: ReactNode;
}) {
  const open = views.length > 0;
  const column = useMistyPanelStore((s) => s.width);
  const [shown, setShown] = useState(views);
  const key = views.join(",");
  useEffect(() => {
    if (key) setShown(key.split(",") as MistyPanelView[]);
  }, [key]);
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [sliding, setSliding] = useState(false);
  useEffect(() => {
    setSliding(true);
    const settled = window.setTimeout(() => setSliding(false), slideMs);
    if (open) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => setExpanded(true));
      return () => {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(settled);
      };
    }
    setExpanded(false);
    const timer = window.setTimeout(() => setMounted(false), slideMs);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(settled);
    };
  }, [open]);
  useEffect(() => {
    geometryChanged();
    const timer = window.setTimeout(geometryChanged, slideMs + 20);
    return () => window.clearTimeout(timer);
  }, [expanded, mounted, side, key]);
  if (!mounted) return null;
  const list = open ? views : shown;
  return (
    <div
      className={cn(
        "relative h-full min-h-0 shrink-0",
        sliding &&
          "transition-[width] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
      )}
      style={{
        width: expanded ? remCss(column + panelGap) : 0,
        ...(sliding ? { transitionDuration: `${slideMs}ms` } : {}),
      }}
      inert={!open}
      data-misty-panel-dock={side}
    >
      <Surface
        tone="chrome"
        className={cn(
          "flex h-full w-full overflow-hidden",
          side === "left" ? "justify-end" : "justify-start",
        )}
        style={
          side === "left" ? { paddingRight: remCss(panelGap) } : { paddingLeft: remCss(panelGap) }
        }
      >
        <div
          className="flex h-full min-h-0 shrink-0 flex-col"
          style={{ width: remCss(column) }}
          data-misty-panel-stack
        >
          {list.map((view, index) => (
            <Fragment key={view}>
              {index > 0 ? <div className="shrink-0" style={{ height: remCss(panelGap) }} /> : null}
              <div
                className={cn(
                  "relative flex min-h-0 basis-0",
                  side === "left" ? "justify-start" : "justify-end",
                )}
                style={
                  {
                    flexGrow: 1,
                    "--misty-panel-width": remCss(column),
                  } as CSSProperties
                }
                data-misty-panel-card={view}
              >
                {chat}
                {open ? <MistyPanelResizer side={side} width={column} /> : null}
              </div>
            </Fragment>
          ))}
        </div>
      </Surface>
    </div>
  );
}

function MistyPanelResizer({ side, width }: { side: MistyPanelSide; width: number }) {
  const { dragging, start } = useEdgeDrag("misty-panel-resize");
  const setWidth = (next: number) => useMistyPanelStore.getState().setWidth(next);
  const direction = side === "right" ? -1 : 1;
  const down = (event: PointerEvent<HTMLDivElement>) => {
    const origin = { x: event.clientX, width };
    start(event, (next, end) => {
      const dragged = origin.width + direction * designPx(next.clientX - origin.x);
      if (dragged < MISTY_PANEL_MIN_WIDTH - closeDistance) {
        end();
        useMistyPanelStore.getState().close();
        return;
      }
      setWidth(dragged);
    });
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") setWidth(width - direction * step);
    else if (event.key === "ArrowRight") setWidth(width + direction * step);
    else if (event.key === "Home") setWidth(MISTY_PANEL_MIN_WIDTH);
    else if (event.key === "End") setWidth(MISTY_PANEL_MAX_WIDTH);
    else return;
    event.preventDefault();
    geometryChanged();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat panel"
      aria-valuenow={width}
      aria-valuemin={MISTY_PANEL_MIN_WIDTH}
      aria-valuemax={MISTY_PANEL_MAX_WIDTH}
      tabIndex={0}
      className="absolute inset-y-0 z-[var(--stack-above-2)] w-3 cursor-col-resize touch-none outline-none"
      data-side={side}
      data-dragging={dragging || undefined}
      style={side === "right" ? { right: remCss(width - 6) } : { left: remCss(width - 6) }}
      onPointerDown={down}
      onDoubleClick={() => {
        setWidth(MISTY_PANEL_WIDTH);
        geometryChanged();
      }}
      onKeyDown={key}
    />
  );
}
