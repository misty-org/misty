import { TourInfoButton } from "@/features/onboarding";
import { Blocks, Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { usePointerDrag, usePointerDropTarget } from "@/shared/hooks/usePointerReorder";
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
  BottomBar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  OverflowFadeText,
  Pressable,
  Surface,
  Text,
} from "@/shared/ui";
import { dropZoneAt } from "./dockSplitFit";
import { ViewIcon } from "./WorkspaceViewGroupButton";

const dragScope = "layout-popup";

/** The part of a pane a drop on `zone` fills: its middle, or the half on that side. */
function zoneRect(rect: DOMRect, zone: DockDropZone): DOMRect {
  const inset = 8;
  const { left, top, width, height } = rect;
  const halfWidth = width / 2 - inset;
  const halfHeight = height / 2 - inset;
  if (zone === "left") return new DOMRect(left + inset, top + inset, halfWidth, height - inset * 2);
  if (zone === "right")
    return new DOMRect(left + width / 2, top + inset, halfWidth, height - inset * 2);
  if (zone === "up") return new DOMRect(left + inset, top + inset, width - inset * 2, halfHeight);
  if (zone === "down")
    return new DOMRect(left + inset, top + height / 2, width - inset * 2, halfHeight);
  return new DOMRect(left + inset, top + inset, width - inset * 2, height - inset * 2);
}

/** Nothing pressed inside the popup reaches the window behind it through React's tree. */
const contained = (event: SyntheticEvent) => event.stopPropagation();

/** A page in the list: a press adds it where the grid has room, and dragging it places it. */
function LayoutListRow(props: { view: WorkspaceView; placed: boolean; onAdd(): void }) {
  const { view } = props;
  const drag = usePointerDrag({ id: view.id, label: paneViewLabel(view), scope: dragScope });
  return (
    <Pressable
      data-reorder-handle=""
      data-reorder-preview=""
      onPointerDown={(event) => {
        contained(event);
        drag(event);
      }}
      onClick={props.onAdd}
      wash="control"
      className={cn(
        "flex h-8 w-full cursor-grab touch-none select-none items-center rounded-md px-2",
        "text-sm active:cursor-grabbing",
      )}
    >
      <Text
        bare
        tone={props.placed ? "bright" : "muted"}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <ViewIcon tab={view.placeholder ? undefined : view} icon={Blocks} />
        <OverflowFadeText className="flex-1 text-left">{paneViewLabel(view)}</OverflowFadeText>
        {props.placed ? <Check aria-hidden="true" /> : null}
      </Text>
    </Pressable>
  );
}

/**
 * One pane of the draft, drawn as a card. Dragging it moves it; a page dropped on its sides splits
 * it, and one dropped on its middle takes its place.
 */
function DraftPane(props: {
  pane: WorkspacePane;
  canPlace(viewId: string, paneId: string, zone: DockDropZone): boolean;
  onPlace(viewId: string, paneId: string, zone: DockDropZone): void;
  onRemove(viewId: string): void;
}) {
  const { pane } = props;
  const view = pane.views[0];
  const ref = useRef<HTMLDivElement>(null);
  const drag = usePointerDrag({
    id: view?.id ?? pane.id,
    label: paneViewLabel(view),
    scope: dragScope,
  });
  usePointerDropTarget(ref, {
    scope: dragScope,
    hit(x, y, moving) {
      const rect = ref.current?.getBoundingClientRect();
      // A pane dropped on itself stays where it is.
      if (!rect || moving.id === view?.id) return null;
      const zone = dropZoneAt(rect, x, y);
      if (!props.canPlace(moving.id, pane.id, zone)) return null;
      return {
        id: zone,
        after: false,
        rect,
        previewRect: zoneRect(rect, zone),
        axis: "x",
        box: true,
      };
    },
    drop: (moving, hit) => props.onPlace(moving.id, pane.id, hit.id as DockDropZone),
  });
  return (
    <Surface
      tone="card"
      edge="dashed"
      radius="xl"
      wash="card"
      ref={ref}
      data-layout-pane={pane.id}
      data-reorder-handle=""
      data-reorder-preview=""
      onPointerDown={(event) => {
        contained(event);
        if (view) drag(event);
      }}
      className={cn(
        "group relative flex min-h-0 min-w-0 flex-1 cursor-grab touch-none select-none flex-col",
        "items-center justify-center gap-2 p-3 text-center shadow-lg shadow-black/30",
        "active:cursor-grabbing",
      )}
    >
      <ViewIcon tab={view?.placeholder ? undefined : view} icon={Blocks} size={22} />
      <Text lines={2} tone="bright" className="max-w-full text-sm">
        {paneViewLabel(view)}
      </Text>
      <IconButton
        label={`Remove ${paneViewLabel(view)} from the layout`}
        size="sm"
        data-reorder-ignore=""
        onPointerDown={contained}
        onClick={() => props.onRemove(view.id)}
        className={cn(
          "absolute right-1.5 top-1.5 opacity-0",
          "focus-visible:opacity-100 group-hover:opacity-100",
        )}
      >
        <X aria-hidden="true" />
      </IconButton>
    </Surface>
  );
}

function DraftTree(props: {
  node: WorkspaceDockNode;
  canPlace(viewId: string, paneId: string, zone: DockDropZone): boolean;
  onPlace(viewId: string, paneId: string, zone: DockDropZone): void;
  onRemove(viewId: string): void;
}) {
  const { node } = props;
  if (node.type === "leaf") return <DraftPane {...props} pane={node} />;
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

/** The canvas with nothing on it: the first page dropped here becomes the only pane. */
function EmptyCanvas(props: { onPlace(viewId: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePointerDropTarget(ref, {
    scope: dragScope,
    hit(_x, _y) {
      const rect = ref.current?.getBoundingClientRect();
      return rect
        ? {
            id: "center",
            after: false,
            rect,
            previewRect: zoneRect(rect, "center"),
            axis: "x",
            box: true,
          }
        : null;
    },
    drop: (moving) => props.onPlace(moving.id),
  });
  return (
    <Surface
      tone="none"
      edge="dashed"
      radius="xl"
      ref={ref}
      className="grid flex-1 place-items-center border-2"
    >
      <Text tone="muted" className="text-sm">
        Drag a tab here
      </Text>
    </Surface>
  );
}

/**
 * The layout popup: a small copy of the window. Tabs are on the left with search, and the page's
 * layout is on the right as panes. A tab is dragged onto a pane's sides to split it, or onto its
 * middle to take its place; a press adds it where the grid has room. Drags use the app's shared
 * pointer drag, which captures the pointer and never starts a native drag. Nothing in the window changes until Apply, and nothing
 * pressed here reaches the tabs behind it.
 */
export function LayoutPopup(props: { onApplied: () => void }) {
  const active = useLayoutEditor((state) => state.active);
  const layout = useWorkspaceStore((state) => state.layout);
  const [baseTabId, setBaseTabId] = useState<string | null>(null);
  const [original, setOriginal] = useState<WorkspaceDockNode | null>(null);
  const [draft, setDraft] = useState<WorkspaceDockNode | null>(null);
  const [notice, setNotice] = useState("");

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

  const views = useMemo(() => allLayoutViews(layout), [layout]);
  const placed = new Set(
    draft ? dockLeaves(draft).flatMap((pane) => pane.views.map((view) => view.id)) : [],
  );

  const sourceOf = (viewId: string) =>
    allLayoutPanes(layout).find((pane) => pane.views[0]?.id === viewId);

  /** Whether a page dropped on a pane's side or middle fits the grid. */
  const canPlace = (viewId: string, paneId: string, zone: DockDropZone) => {
    const view = views.find((item) => item.id === viewId);
    return Boolean(view && draft && draftPlace(draft, view, paneId, zone, sourceOf(viewId)));
  };

  const place = (viewId: string, paneId: string | null, zone: DockDropZone) => {
    const view = views.find((item) => item.id === viewId);
    if (!view) return;
    const source = sourceOf(viewId);
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
    const source = sourceOf(view.id);
    const next = draft ? draftAdd(draft, view, source) : createDockLeaf([view]);
    if (!next) {
      setNotice("The window fits at most a 2 by 2 grid");
      return;
    }
    setNotice("");
    setDraft(next);
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
        <div className="flex h-full min-h-0 flex-col">
          <div className="relative grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
            <div className="relative flex min-h-0 flex-col gap-2 border-r p-3">
              <ul
                className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1"
                data-tour="layout-tabs"
              >
                {views.map((view) => (
                  <li key={view.id}>
                    <LayoutListRow
                      view={view}
                      placed={placed.has(view.id)}
                      onAdd={() => addFromList(view)}
                    />
                  </li>
                ))}
              </ul>
            </div>
            <div
              data-layout-canvas
              data-tour="layout-canvas"
              className="relative flex min-h-0 min-w-0 p-5"
            >
              {draft ? (
                <DraftTree
                  node={draft}
                  canPlace={canPlace}
                  onPlace={place}
                  onRemove={(viewId) => setDraft(draftRemove(draft, viewId))}
                />
              ) : (
                <EmptyCanvas onPlace={(viewId) => place(viewId, null, "center")} />
              )}
            </div>
          </div>
          <BottomBar
            aria-label="Layout"
            start={
              <Text bare role="status" tone="muted" className="text-xs">
                {notice}
              </Text>
            }
          >
            <div data-tour="layout-apply" className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => useLayoutEditor.getState().stop()}
              >
                Cancel
              </Button>
              <Button variant="primary" size="lg" disabled={!draft || !changed} onClick={apply}>
                Apply
              </Button>
            </div>
            <TourInfoButton tour="layout" />
          </BottomBar>
        </div>
      </DialogContent>
    </Dialog>
  );
}
