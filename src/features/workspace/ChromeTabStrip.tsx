import type { ChromeTabStripTab, ChromeTabStripProps } from "@/models/interfaces/workspace";
export type { ChromeTabStripTab, ChromeTabStripProps } from "@/models/interfaces/workspace";
import { Button } from "@/ui";
import { Plus, X } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type WheelEvent,
} from "react";
import { useExplorerDropRegistry } from "@/features/explorer/drag/ExplorerDragContext";
import { createExplorerDropTargetSpec } from "@/features/explorer/drag/ExplorerDropTarget";

const chromeTabShellClass = [
  "flex h-[46px] min-w-0 overflow-hidden border-b border-charcoal-border bg-charcoal-sidebar",
].join(" ");

const tabCloseButtonClass = [
  "mr-1.5 grid size-6 flex-none place-items-center rounded-full border-0",
  "bg-transparent text-current transition-colors hover:text-cream-bright",
].join(" ");

const chromeTabTrayClass = [
  "mt-1.5 mr-2 flex h-8 flex-none items-center justify-end gap-0.5 rounded-lg p-0.5",
].join(" ");

export const ChromeTabStrip = memo(function ChromeTabStrip(props: ChromeTabStripProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const draggedTabIdRef = useRef<string | null>(null);
  const suppressSelectionRef = useRef(false);
  const [draggedTabId, setDraggedTabId] = useState("");
  const [renamingTabId, setRenamingTabId] = useState("");
  const [dropIndicator, setDropIndicator] = useState<{
    tabId: string;
    position: "before" | "after";
  }>();
  const registerDropZone = useExplorerDropRegistry();

  useEffect(() => {
    if (!registerDropZone) return;
    let disposed = false;
    let cleanups: Array<() => void> = [];
    const frame = window.requestAnimationFrame(() => {
      if (disposed || !shellRef.current) return;
      cleanups = props.tabs.flatMap((tab) => {
        const element = Array.from(
          shellRef.current?.querySelectorAll<HTMLElement>(".chrome-tab[data-tab-id]") ?? [],
        ).find((candidate) => candidate.dataset.tabId === tab.id);
        if (!element) return [];
        const spec = createExplorerDropTargetSpec({
          id: `tab:${tab.id}`,
          path: tab.path,
          paneId: tab.paneId,
          springLoad: tab.id !== props.activeTabId,
          onSpringLoad: () => props.onSelectTab(tab.id),
        });
        return [registerDropZone(element, spec)];
      });
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [props.activeTabId, props.onSelectTab, props.tabs, registerDropZone]);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const tabs = tabsRef.current;
    if (!tabs || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    tabs.scrollLeft += event.deltaY;
    event.preventDefault();
  }, []);

  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, tabId: string) => {
    draggedTabIdRef.current = tabId;
    suppressSelectionRef.current = true;
    setDraggedTabId(tabId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-misty-workspace-tab", tabId);
    event.dataTransfer.setData("text/plain", tabId);
  }, []);

  const finishTabDrag = useCallback(() => {
    draggedTabIdRef.current = null;
    setDraggedTabId("");
    setDropIndicator(undefined);
    window.setTimeout(() => {
      suppressSelectionRef.current = false;
    }, 0);
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, destinationTabId: string) => {
      const sourceTabId = draggedTabIdRef.current;
      if (!props.onReorderTab || !sourceTabId || sourceTabId === destinationTabId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const bounds = event.currentTarget.getBoundingClientRect();
      setDropIndicator({
        tabId: destinationTabId,
        position: event.clientX >= bounds.left + bounds.width / 2 ? "after" : "before",
      });
    },
    [props.onReorderTab],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, destinationTabId: string) => {
      const sourceTabId =
        draggedTabIdRef.current ||
        event.dataTransfer.getData("application/x-misty-workspace-tab").trim();
      if (!sourceTabId || sourceTabId === destinationTabId || !props.onReorderTab)
        return void finishTabDrag();
      event.preventDefault();
      event.stopPropagation();
      const fromIndex = props.tabs.findIndex((tab) => tab.id === sourceTabId);
      const bounds = event.currentTarget.getBoundingClientRect();
      const toIndex = workspaceTabDropIndex(
        props.tabs.map((tab) => tab.id),
        sourceTabId,
        destinationTabId,
        event.clientX >= bounds.left + bounds.width / 2,
      );
      if (fromIndex < 0 || toIndex < 0) return void finishTabDrag();
      props.onReorderTab(sourceTabId, fromIndex, toIndex);
      finishTabDrag();
    },
    [finishTabDrag, props.onReorderTab, props.tabs],
  );

  return (
    <div ref={shellRef} className={chromeTabShellClass}>
      <div
        ref={tabsRef}
        className="flex h-[46px] min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={props.ariaLabel ?? "Open locations"}
        onWheel={handleWheel}
      >
        {props.tabs.map((tab) => {
          const active = tab.id === props.activeTabId;
          const canClose = props.canCloseTab ? props.canCloseTab(tab) : true;
          const canRename = Boolean(props.onRenameTab && props.canRenameTab?.(tab));
          const renaming = canRename && renamingTabId === tab.id;
          return (
            <div
              key={tab.id}
              className={[
                "chrome-tab relative flex h-9 min-w-[92px] max-w-60 flex-[1_1_180px] items-center overflow-hidden rounded-t-lg border border-charcoal-border",
                "text-cream-muted transition-colors",
                // The selected tab takes the colour of the pane it opens onto,
                // the way a browser tab joins its page, instead of a fill that
                // belongs to nothing below it.
                active
                  ? "shrink-[0.85] border-b-charcoal-bg bg-charcoal-bg text-cream-bright"
                  : "bg-charcoal-card hover:text-cream-bright",
                draggedTabId === tab.id ? "opacity-55" : "",
              ].join(" ")}
              data-tab-id={tab.id}
              data-active={active ? "true" : "false"}
              data-dragging={draggedTabId === tab.id ? "true" : undefined}
              data-drop-position={
                dropIndicator?.tabId === tab.id ? dropIndicator.position : undefined
              }
              data-misty-window-drag-block={props.onReorderTab ? "true" : undefined}
              data-reorder-drag-source={props.onReorderTab ? "true" : undefined}
              // Dragging a tab mid-rename would tear the caret out of the field.
              draggable={Boolean(props.onReorderTab) && !renaming}
              onDragEnd={finishTabDrag}
              onDragOver={(event) => handleDragOver(event, tab.id)}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                if (dropIndicator?.tabId === tab.id) setDropIndicator(undefined);
              }}
              onDragStart={(event) => handleDragStart(event, tab.id)}
              onDrop={(event) => handleDrop(event, tab.id)}
            >
              {dropIndicator?.tabId === tab.id ? (
                <span
                  className={`pointer-events-none absolute inset-y-1 z-[3] w-0.5 rounded-full bg-cream ${dropIndicator.position === "before" ? "left-0.5" : "right-0.5"}`}
                  aria-hidden="true"
                />
              ) : null}
              {renaming ? (
                <TabTitleInput
                  title={tab.title}
                  onCancel={() => setRenamingTabId("")}
                  onCommit={(next) => {
                    setRenamingTabId("");
                    if (next && next !== tab.title) props.onRenameTab?.(tab.id, next);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="flex h-full min-w-0 flex-1 items-center overflow-hidden border-0 bg-transparent py-0 pl-3 pr-1.5 text-left text-inherit"
                  role="tab"
                  aria-selected={active}
                  title={tab.path}
                  onClick={() => {
                    if (!suppressSelectionRef.current) props.onSelectTab(tab.id);
                  }}
                  onDoubleClick={() => {
                    if (canRename) setRenamingTabId(tab.id);
                  }}
                >
                  <span className="min-w-0 truncate text-[13px] font-medium">{tab.title}</span>
                </button>
              )}
              {canClose ? (
                <button
                  type="button"
                  className={tabCloseButtonClass}
                  aria-label={`Close ${tab.title}`}
                  title={`Close ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onCloseTab(tab);
                  }}
                >
                  <X size={13} strokeWidth={2} />
                </button>
              ) : null}
            </div>
          );
        })}
        {/* Sits on the tab row's own baseline; the old bottom padding lifted
            it above the tab titles it belongs beside. */}
        <div className="flex h-9 flex-none items-center pl-1">
          {props.addTabControl ?? (
            <Button
              type="button"
              className="grid size-7 place-items-center rounded-full border-0 bg-transparent p-0 text-cream-muted hover:text-cream-bright"
              title="New tab"
              onClick={props.onAddTab}
            >
              <Plus size={17} strokeWidth={2.4} />
            </Button>
          )}
        </div>
      </div>
      {props.actions ? <div className={chromeTabTrayClass}>{props.actions}</div> : null}
    </div>
  );
});

/**
 * Inline tab rename. Blur commits rather than cancels, matching how the rest of
 * the app treats an edited-then-abandoned field; Escape is the way out.
 */
function TabTitleInput(props: {
  title: string;
  onCancel: () => void;
  onCommit: (title: string) => void;
}) {
  const [value, setValue] = useState(props.title);
  const canceledRef = useRef(false);

  return (
    <input
      className="h-full min-w-0 flex-1 border-none bg-transparent px-3 text-[13px] font-medium text-cream-bright outline-none"
      value={value}
      autoFocus
      maxLength={60}
      aria-label={`Rename ${props.title}`}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => {
        if (canceledRef.current) return;
        props.onCommit(value.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          props.onCommit(value.trim());
        }
        if (event.key === "Escape") {
          event.preventDefault();
          canceledRef.current = true;
          props.onCancel();
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}

export function workspaceTabDropIndex(
  order: string[],
  sourceId: string,
  targetId: string,
  insertAfter: boolean,
): number {
  if (sourceId === targetId || !order.includes(sourceId) || !order.includes(targetId)) return -1;
  const remaining = order.filter((id) => id !== sourceId);
  const targetIndex = remaining.indexOf(targetId);
  return targetIndex + (insertAfter ? 1 : 0);
}
