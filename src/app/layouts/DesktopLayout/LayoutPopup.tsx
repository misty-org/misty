import { Blocks, Check, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type SyntheticEvent,
} from "react";
import {
  allLayoutPanes,
  allLayoutViews,
  createDockLeaf,
  dockLeaves,
  draftAdd,
  draftPlace,
  draftRemove,
  paneViewLabel,
  setBrowserWebviewsSuspended,
  useLayoutEditor,
  useWorkspaceStore,
  type DockDropZone,
  type WorkspaceDockNode,
  type WorkspacePane,
  type WorkspaceView,
} from "@/features/app-windows";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  OverflowFadeText,
} from "@/shared/ui";
import { DockDropPreview } from "./DockDropPreview";
import { dropZoneAt } from "./dockSplitFit";
import { ViewIcon } from "./WorkspaceViewGroupButton";

/** Where the pointer is over the draft: a pane and the side of it, or the empty canvas. */
interface Hover {
  paneId: string | null;
  zone: DockDropZone;
}

interface Dragging {
  label: string;
  x: number;
  y: number;
}

/** Nothing pressed inside the popup reaches the window behind it through React's tree. */
const contained = (event: SyntheticEvent) => event.stopPropagation();

/** One pane of the draft, drawn as a card. Pressing and moving it picks it up to place it elsewhere. */
function DraftPane(props: {
  pane: WorkspacePane;
  zone: DockDropZone | null;
  onPick(event: PointerEvent, view: WorkspaceView): void;
  onRemove(viewId: string): void;
}) {
  const { pane } = props;
  const view = pane.views[0];
  return (
    <div
      data-layout-pane={pane.id}
      onPointerDown={(event) => props.onPick(event, view)}
      className={cn(
        "group relative flex min-h-0 min-w-0 flex-1 cursor-grab select-none flex-col items-center",
        "justify-center gap-2 rounded-xl border border-dashed border-cream/40 bg-charcoal-card p-3",
        "text-center shadow-lg shadow-black/30 hover:border-cream/70 active:cursor-grabbing",
      )}
    >
      <ViewIcon tab={view?.placeholder ? undefined : view} icon={Blocks} size={22} />
      <OverflowFadeText lines={2} className="max-w-full text-sm text-cream-bright">
        {paneViewLabel(view)}
      </OverflowFadeText>
      <IconButton
        label={`Remove ${paneViewLabel(view)} from the layout`}
        size="sm"
        onPointerDown={contained}
        onClick={() => props.onRemove(view.id)}
        className={cn(
          "absolute right-1.5 top-1.5 text-cream-muted opacity-0 hover:text-cream-bright",
          "focus-visible:opacity-100 group-hover:opacity-100",
        )}
      >
        <X aria-hidden="true" />
      </IconButton>
      {props.zone ? <DockDropPreview zone={props.zone} /> : null}
    </div>
  );
}

function DraftTree(props: {
  node: WorkspaceDockNode;
  hover: Hover | null;
  onPick(event: PointerEvent, view: WorkspaceView): void;
  onRemove(viewId: string): void;
}) {
  const { node } = props;
  if (node.type === "leaf")
    return (
      <DraftPane
        pane={node}
        zone={props.hover?.paneId === node.id ? props.hover.zone : null}
        onPick={props.onPick}
        onRemove={props.onRemove}
      />
    );
  const horizontal = node.direction === "horizontal";
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 gap-3", horizontal ? "flex-row" : "flex-col")}>
      <div className="flex min-h-0 min-w-0" style={{ flex: node.ratio }}>
        <DraftTree {...props} node={node.first} />
      </div>
      <div className="flex min-h-0 min-w-0" style={{ flex: 1 - node.ratio }}>
        <DraftTree {...props} node={node.second} />
      </div>
    </div>
  );
}

/**
 * The layout popup: a small copy of the window. Tabs are on the left with search, and the page's
 * layout is on the right as panes. A tab is pressed and moved onto a pane's sides to split
 * it, or onto its middle to take its place. Nothing in the window changes until Apply, and nothing
 * pressed here reaches the tabs behind it.
 */
export function LayoutPopup(props: { onApplied: () => void }) {
  const active = useLayoutEditor((state) => state.active);
  const layout = useWorkspaceStore((state) => state.layout);
  const [baseTabId, setBaseTabId] = useState<string | null>(null);
  const [original, setOriginal] = useState<WorkspaceDockNode | null>(null);
  const [draft, setDraft] = useState<WorkspaceDockNode | null>(null);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // Tabs made in the popup exist only in the draft until Apply, so Cancel leaves no trace of them.
  const letGo = useRef<(() => void) | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  // The popup starts from the tab the window is showing when it opens.
  useEffect(() => {
    if (!active) return;
    const state = useWorkspaceStore.getState().layout;
    setBaseTabId(state.activeTabId ?? null);
    setOriginal(state.root);
    setDraft(state.root);
    setNotice("");
  }, [active]);

  useEffect(() => {
    setBrowserWebviewsSuspended(active, "layout-popup");
    return () => setBrowserWebviewsSuspended(false, "layout-popup");
  }, [active]);

  // Closing in the middle of a drag drops it.
  useEffect(() => () => letGo.current?.(), []);

  const views = useMemo(() => allLayoutViews(layout), [layout]);
  const placed = new Set(
    draft ? dockLeaves(draft).flatMap((pane) => pane.views.map((view) => view.id)) : [],
  );

  const place = (viewId: string, paneId: string | null, zone: DockDropZone) => {
    const view = views.find((item) => item.id === viewId);
    if (!view) return;
    const source = allLayoutPanes(layout).find((pane) => pane.views[0]?.id === viewId);
    const next = draft && paneId ? draftPlace(draft, view, paneId, zone, source) : null;
    if (draft && paneId && !next) {
      if (zone !== "center") setNotice("The window fits at most a 2 by 2 grid");
      return;
    }
    setNotice("");
    if (next) setDraft(next);
    // On an empty canvas the page becomes the first pane.
    else if (!draft)
      setDraft(
        source ? { ...source, views: [view], activeViewId: view.id } : createDockLeaf([view]),
      );
  };

  /** A tab pressed in the list joins where the grid has room, as a way in without dragging. */
  const addFromList = (view: WorkspaceView) => {
    if (placed.has(view.id)) return;
    const source = allLayoutPanes(layout).find((pane) => pane.views[0]?.id === view.id);
    const next = draft ? draftAdd(draft, view, source) : createDockLeaf([view]);
    if (!next) {
      setNotice("The window fits at most a 2 by 2 grid");
      return;
    }
    setNotice("");
    setDraft(next);
  };

  /** What is under the pointer: a pane and the side of it, or the empty canvas. */
  const hitTest = (viewId: string, x: number, y: number): Hover | null => {
    const under = document.elementFromPoint(x, y);
    const pane = under?.closest<HTMLElement>("[data-layout-pane]");
    if (pane?.dataset.layoutPane) {
      const paneId = pane.dataset.layoutPane;
      const own = draft && dockLeaves(draft).find((leaf) => leaf.id === paneId);
      // A pane dropped on itself stays where it is.
      if (own?.views.some((view) => view.id === viewId)) return null;
      return { paneId, zone: dropZoneAt(pane.getBoundingClientRect(), x, y) };
    }
    if (!draft && under?.closest("[data-layout-canvas]")) return { paneId: null, zone: "center" };
    return null;
  };

  /** Pressing a tab or a pane: a short press adds or does nothing, and moving it drags it. */
  const pick = (event: PointerEvent, view: WorkspaceView, onPress?: () => void) => {
    if (event.button !== 0) return;
    contained(event);
    const startX = event.clientX;
    const startY = event.clientY;
    const label = paneViewLabel(view);
    let moved = false;
    const move = (at: globalThis.PointerEvent) => {
      if (!moved && Math.hypot(at.clientX - startX, at.clientY - startY) < 5) return;
      moved = true;
      const origin = frame.current?.getBoundingClientRect();
      setDragging({
        label,
        x: at.clientX - (origin?.left ?? 0),
        y: at.clientY - (origin?.top ?? 0),
      });
      setHover(hitTest(view.id, at.clientX, at.clientY));
    };
    const end = (at: globalThis.PointerEvent | null) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      letGo.current = null;
      setDragging(null);
      setHover(null);
      if (!at) return;
      if (!moved) return onPress?.();
      const target = hitTest(view.id, at.clientX, at.clientY);
      if (target) place(view.id, target.paneId, target.zone);
    };
    const up = (at: globalThis.PointerEvent) => end(at);
    const cancel = () => end(null);
    letGo.current = cancel;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  };

  const apply = () => {
    if (!baseTabId || !draft) return;
    if (useWorkspaceStore.getState().applyLayoutRoot(baseTabId, draft)) props.onApplied();
    useLayoutEditor.getState().stop();
  };

  const changed = draft !== original;
  return (
    <Dialog open={active} onOpenChange={(next) => !next && useLayoutEditor.getState().stop()}>
      <DialogContent
        placement="top"
        onPointerDown={contained}
        onPointerMove={contained}
        onPointerUp={contained}
        onMouseDown={contained}
        onDragStart={contained}
        onDragOver={contained}
        onDrop={contained}
        className={cn(
          "h-[min(560px,calc(100dvh-8rem))] w-[min(900px,calc(100vw-4rem))] max-w-none",
          "gap-0 overflow-hidden rounded-xl p-0",
          "[&>[data-slot=dialog-close]]:hidden",
        )}
      >
        <DialogTitle className="sr-only">Layout</DialogTitle>
        <DialogDescription className="sr-only">
          Drag tabs onto the canvas to split the window. Nothing changes until you apply.
        </DialogDescription>
        <div ref={frame} className="relative grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-2 border-r border-charcoal-border p-3">
            <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
              {views.map((view) => (
                <li key={view.id}>
                  <div
                    onPointerDown={(event) => pick(event, view, () => addFromList(view))}
                    className={cn(
                      "flex h-8 cursor-grab touch-none select-none items-center gap-2 rounded-md px-2",
                      "text-sm hover:bg-control-hover active:cursor-grabbing",
                      placed.has(view.id) ? "text-cream-bright" : "text-cream-muted",
                    )}
                  >
                    <ViewIcon tab={view.placeholder ? undefined : view} icon={Blocks} />
                    <OverflowFadeText className="flex-1">{paneViewLabel(view)}</OverflowFadeText>
                    {placed.has(view.id) ? <Check size={14} aria-hidden="true" /> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div data-layout-canvas className={"relative flex min-h-0 min-w-0 p-5 pb-16"}>
            {draft ? (
              <DraftTree
                node={draft}
                hover={hover}
                onPick={(event, view) => pick(event, view)}
                onRemove={(viewId) => setDraft(draftRemove(draft, viewId))}
              />
            ) : (
              <div
                className={cn(
                  "grid flex-1 place-items-center rounded-xl border-2 border-dashed text-sm",
                  hover ? "border-cream/60 text-cream-bright" : "border-cream/25 text-cream-muted",
                )}
              >
                Drag a tab here
              </div>
            )}
            <div className="absolute bottom-4 right-4 flex items-center gap-2">
              <span role="status" className="mr-2 text-xs text-cream-muted">
                {notice}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => useLayoutEditor.getState().stop()}
              >
                Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={!draft || !changed} onClick={apply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
        {dragging ? (
          <div
            className={cn(
              "pointer-events-none absolute z-50 max-w-56 rounded-md border",
              "border-charcoal-border bg-charcoal-card px-2 py-1 text-sm text-cream-bright shadow-lg",
            )}
            style={{ left: dragging.x + 12, top: dragging.y + 12 }}
          >
            <OverflowFadeText>{dragging.label}</OverflowFadeText>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
