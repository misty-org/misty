import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { cn } from "@/shared/ui";
import { MistyPanel, type MistyPanelSide } from "./MistyPanel";
import {
  MISTY_PANEL_MAX_SPLIT,
  MISTY_PANEL_MAX_WIDTH,
  MISTY_PANEL_MIN_SPLIT,
  MISTY_PANEL_MIN_WIDTH,
  MISTY_PANEL_SPLIT,
  MISTY_PANEL_WIDTH,
  useMistyPanelStore,
  type MistyPanelView,
} from "./mistyPanelStore";

// Matches the dock's width transition below; the closing panel unmounts after it.
const slideMs = 240;

/** The margin of window chrome between the page and the panels, and between two panels: each
 * is its own rounded card, as the page is. */
export const panelGap = 6;

/** How far past its narrowest the pointer must pull a panel for it to close, in pixels. */
const closeDistance = 70;

const geometryChanged = () => window.dispatchEvent(new Event("misty:workspace-geometry-changed"));

const viewLabel = (view: MistyPanelView) => (view === "chat" ? "chat panel" : "Misty panel");

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
    function end() {
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
    setDragging(true);
    setBrowserWebviewsSuspended(true, reason);
  };
  return { dragging, start };
}

/**
 * The Misty panels' column beside a content area: the agent conversation, your Space's chat,
 * or both, each its own rounded card. The column widens from zero to slide the panels in from
 * the edge, pushing the content aside. Each card's inner edge resizes its width, and the gap
 * between two cards moves the line between them.
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
  const agentsWidth = useMistyPanelStore((s) => s.width);
  const chatWidth = useMistyPanelStore((s) => s.chatWidth);
  const split = useMistyPanelStore((s) => s.split);
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
  const stack = useRef<HTMLDivElement>(null);
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
  // The conversation does not re-render as the width changes: the panel reads the width
  // from a custom property, so a drag only restyles its card. It also stays mounted when
  // the chat panel opens or closes beside it.
  const agents = useMemo(() => <MistyPanel side={side} />, [side]);
  if (!mounted) return null;
  const list = open ? views : shown;
  const widthOf = (view: MistyPanelView) => (view === "chat" ? chatWidth : agentsWidth);
  // The column is as wide as its widest card; a narrower one hugs the window's edge.
  const column = Math.max(0, ...list.map(widthOf));
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
      <div
        className={cn(
          "flex h-full w-full overflow-hidden bg-[var(--misty-window-chrome,var(--misty-theme-workspace))]",
          side === "left" ? "justify-end" : "justify-start",
        )}
        style={side === "left" ? { paddingRight: panelGap } : { paddingLeft: panelGap }}
      >
        <div
          ref={stack}
          className="flex h-full min-h-0 shrink-0 flex-col"
          style={{ width: column }}
          data-misty-panel-stack
        >
          {list.map((view, index) => (
            <Fragment key={view}>
              {index > 0 ? (
                open ? (
                  <MistyPanelSplitter stack={stack} split={split} />
                ) : (
                  <div className="shrink-0" style={{ height: panelGap }} />
                )
              ) : null}
              <div
                className={cn(
                  "relative flex min-h-0 basis-0",
                  side === "left" ? "justify-start" : "justify-end",
                )}
                style={
                  {
                    flexGrow: list.length > 1 ? (index === 0 ? split : 1 - split) : 1,
                    "--misty-panel-width": `${widthOf(view)}px`,
                  } as CSSProperties
                }
                data-misty-panel-card={view}
              >
                {view === "chat" ? chat : agents}
                {open ? (
                  <MistyPanelResizer side={side} view={view} width={widthOf(view)} />
                ) : null}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A card's inner edge. Drag to resize, arrow keys step it, and a double-click restores
 * the default width. Pulled well past its narrowest, the card closes.
 */
function MistyPanelResizer({
  side,
  view,
  width,
}: {
  side: MistyPanelSide;
  view: MistyPanelView;
  width: number;
}) {
  const { dragging, start } = useEdgeDrag("misty-panel-resize");
  const setWidth = (next: number) => useMistyPanelStore.getState().setWidth(next, view);
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
        useMistyPanelStore.getState().close(view);
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
      aria-label={`Resize ${viewLabel(view)}`}
      aria-valuenow={width}
      aria-valuemin={MISTY_PANEL_MIN_WIDTH}
      aria-valuemax={MISTY_PANEL_MAX_WIDTH}
      tabIndex={0}
      className="misty-panel-resizer"
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

/**
 * The gap between two stacked cards. Drag it to share the column's height differently, arrow
 * keys step it, and a double-click splits it evenly again.
 */
function MistyPanelSplitter({
  stack,
  split,
}: {
  stack: RefObject<HTMLDivElement | null>;
  split: number;
}) {
  const { dragging, start } = useEdgeDrag("misty-panel-split");
  const setSplit = (next: number) => useMistyPanelStore.getState().setSplit(next);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    // The cards share the column's height less the gap between them.
    const height = (stack.current?.getBoundingClientRect().height ?? 0) - panelGap;
    if (height <= 0) return;
    const origin = { y: event.clientY, split };
    start(event, (next) => setSplit(origin.split + (next.clientY - origin.y) / height));
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.025;
    if (event.key === "ArrowUp") setSplit(split - step);
    else if (event.key === "ArrowDown") setSplit(split + step);
    else if (event.key === "Home") setSplit(MISTY_PANEL_MIN_SPLIT);
    else if (event.key === "End") setSplit(MISTY_PANEL_MAX_SPLIT);
    else return;
    event.preventDefault();
    geometryChanged();
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panels"
      aria-valuenow={Math.round(split * 100)}
      aria-valuemin={MISTY_PANEL_MIN_SPLIT * 100}
      aria-valuemax={MISTY_PANEL_MAX_SPLIT * 100}
      tabIndex={0}
      className="misty-panel-splitter"
      style={{ height: panelGap }}
      data-dragging={dragging || undefined}
      onPointerDown={down}
      onDoubleClick={() => {
        setSplit(MISTY_PANEL_SPLIT);
        geometryChanged();
      }}
      onKeyDown={key}
    />
  );
}
