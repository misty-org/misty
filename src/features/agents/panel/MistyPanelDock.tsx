import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { cn } from "@/shared/ui";
import { MistyPanel, type MistyPanelSide } from "./MistyPanel";
import {
  MISTY_PANEL_MAX_WIDTH,
  MISTY_PANEL_MIN_WIDTH,
  MISTY_PANEL_WIDTH,
  useMistyPanelStore,
} from "./mistyPanelStore";

// Matches the dock's width transition below; the closing panel unmounts after it.
const slideMs = 240;

/** The margin of window chrome between the page and the panel, as between the tab drawer and the
 * page: each is its own rounded panel. */
const panelGap = 8;

const geometryChanged = () => window.dispatchEvent(new Event("misty:workspace-geometry-changed"));

/**
 * The Misty panel's column beside a content area. It widens from zero to slide the panel
 * in from the edge, pushing the content aside, and its inner edge resizes it.
 */
export function MistyPanelDock({ open, side }: { open: boolean; side: MistyPanelSide }) {
  const width = useMistyPanelStore((s) => s.width);
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
  }, [expanded, mounted, side]);
  // The conversation does not re-render as the width changes: the panel reads the width
  // from a custom property, so a drag only restyles this column.
  const panel = useMemo(() => <MistyPanel side={side} />, [side]);
  if (!mounted) return null;
  return (
    <div
      className={cn(
        "relative h-full min-h-0 shrink-0",
        sliding &&
          "transition-[width] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
      )}
      style={
        {
          width: expanded ? width + panelGap : 0,
          "--misty-panel-width": `${width}px`,
          // Set only while sliding: without a property list, a duration alone would
          // animate every width change, including each step of a drag.
          ...(sliding ? { transitionDuration: `${slideMs}ms` } : {}),
        } as CSSProperties
      }
      inert={!open}
      data-misty-panel-dock={side}
    >
      <div
        className={cn(
          "flex h-full w-full overflow-hidden bg-[var(--misty-window-chrome,var(--misty-theme-workspace))]",
          side === "left" ? "justify-end pr-2" : "justify-start pl-2",
        )}
      >
        {panel}
      </div>
      {open ? <MistyPanelResizer side={side} width={width} /> : null}
    </div>
  );
}

/**
 * The panel's inner edge. Drag to resize, arrow keys step it, and a double-click restores
 * the default width.
 */
function MistyPanelResizer({ side, width }: { side: MistyPanelSide; width: number }) {
  const [dragging, setDragging] = useState(false);
  const stop = useRef<() => void>(undefined);
  const setWidth = useMistyPanelStore((s) => s.setWidth);
  // Toward the page widens the panel: leftward for a panel on the right.
  const direction = side === "right" ? -1 : 1;
  useEffect(() => () => stop.current?.(), []);
  // The window follows the drag, not the hairline: the edge moves under the pointer, and
  // AppKit keeps delivering a drag to the app even while it passes over a native page.
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const origin = { x: event.clientX, width };
    const move = (next: globalThis.PointerEvent) =>
      setWidth(origin.width + direction * (next.clientX - origin.x));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      stop.current = undefined;
      setDragging(false);
      geometryChanged();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    stop.current = end;
    setDragging(true);
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
      aria-label="Resize Misty panel"
      aria-valuenow={width}
      aria-valuemin={MISTY_PANEL_MIN_WIDTH}
      aria-valuemax={MISTY_PANEL_MAX_WIDTH}
      tabIndex={0}
      className="misty-panel-resizer"
      data-side={side}
      data-dragging={dragging || undefined}
      onPointerDown={start}
      onDoubleClick={() => {
        setWidth(MISTY_PANEL_WIDTH);
        geometryChanged();
      }}
      onKeyDown={key}
    />
  );
}
