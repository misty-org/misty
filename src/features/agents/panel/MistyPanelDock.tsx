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
import { cn, Surface } from "@/shared/ui";
import type { MistyPanelSide } from "./mistyPanelSide";
import {
  MISTY_PANEL_MAX_WIDTH,
  MISTY_PANEL_MIN_WIDTH,
  MISTY_PANEL_WIDTH,
  useMistyPanelStore,
  type MistyPanelView,
} from "./mistyPanelStore";

// Matches the dock's width transition below; the closing panel unmounts after it.
const slideMs = 240;

/** The margin of window chrome between the page and the panels, and between two panels: each
 * is its own rounded card, as the page is. */
const panelGap = 6;

/** How far past its narrowest the pointer must pull a panel for it to close, in pixels. */
const closeDistance = 70;

const geometryChanged = () => window.dispatchEvent(new Event("misty:workspace-geometry-changed"));

/**
 * Follows one pointer drag on a resize edge until release. Pages pause while it runs, as they do
 * while the tab drawer resizes, so a native page under the pointer cannot swallow the drag.
 */
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
    // The whole window shows the resize cursor and selects nothing while the edge is held.
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

/**
 * The side panel's column beside a content area: your Space's chat, a rounded card of its own.
 * The column widens from zero to slide the panel in from the edge, pushing the content aside.
 * The card's inner edge resizes its width.
 */
export function MistyPanelDock({
  views,
  side,
  chat,
}: {
  /** The panels to show, top first. Empty closes the dock. */
  views: MistyPanelView[];
  side: MistyPanelSide;
  /** The chat panel, supplied by the host so this feature doesn't depend on Spaces. */
  chat?: ReactNode;
}) {
  const open = views.length > 0;
  const column = useMistyPanelStore((s) => s.width);
  // While the dock slides shut it keeps showing what it last showed.
  const [shown, setShown] = useState(views);
  const key = views.join(",");
  useEffect(() => {
    if (key) setShown(key.split(",") as MistyPanelView[]);
  }, [key]);
  // The panel stays mounted while it slides out, then leaves the tree.
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  // Only opening and closing animate; a resize follows the pointer exactly.
  const [sliding, setSliding] = useState(false);
  useEffect(() => {
    setSliding(true);
    const settled = window.setTimeout(() => setSliding(false), slideMs);
    if (open) {
      setMounted(true);
      // Widen on the next frame so the dock starts from zero and slides in.
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
    // Browser pages follow the dock through their ResizeObserver; settle them once it stops.
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
        width: expanded ? column + panelGap : 0,
        // Set only while sliding: without a property list, a duration alone would
        // animate every width change, including each step of a drag.
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
        style={side === "left" ? { paddingRight: panelGap } : { paddingLeft: panelGap }}
      >
        <div
          className="flex h-full min-h-0 shrink-0 flex-col"
          style={{ width: column }}
          data-misty-panel-stack
        >
          {list.map((view, index) => (
            <Fragment key={view}>
              {index > 0 ? <div className="shrink-0" style={{ height: panelGap }} /> : null}
              <div
                className={cn(
                  "relative flex min-h-0 basis-0",
                  side === "left" ? "justify-start" : "justify-end",
                )}
                style={
                  {
                    // Stacked panels share the column's height equally.
                    flexGrow: 1,
                    "--misty-panel-width": `${column}px`,
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

/**
 * A card's inner edge. Drag to resize, arrow keys step it, and a double-click restores
 * the default width. Pulled well past its narrowest, the card closes.
 */
function MistyPanelResizer({ side, width }: { side: MistyPanelSide; width: number }) {
  const { dragging, start } = useEdgeDrag("misty-panel-resize");
  const setWidth = (next: number) => useMistyPanelStore.getState().setWidth(next);
  // Toward the page widens the panel: leftward for a panel on the right.
  const direction = side === "right" ? -1 : 1;
  // The window follows the drag, not the hairline: the edge moves under the pointer.
  const down = (event: PointerEvent<HTMLDivElement>) => {
    const origin = { x: event.clientX, width };
    start(event, (next, end) => {
      const dragged = origin.width + direction * (next.clientX - origin.x);
      // Pulled well past the narrowest it goes, in the closing direction, it closes.
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
      // Centred on the card's inner edge, wherever the card sits in the column.
      style={side === "right" ? { right: width - 6 } : { left: width - 6 }}
      onPointerDown={down}
      onDoubleClick={() => {
        setWidth(MISTY_PANEL_WIDTH);
        geometryChanged();
      }}
      onKeyDown={key}
    />
  );
}
