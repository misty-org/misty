import type { ChromeTabStripTab, ChromeTabStripProps } from "@/models/interfaces/workspace";
export type { ChromeTabStripTab, ChromeTabStripProps } from "@/models/interfaces/workspace";
import { Button } from "@/ui";
import { Plus, X } from "lucide-react";
import "./chromeTabs.css";
import { memo, useCallback, useEffect, useRef, type DragEvent, type WheelEvent } from "react";
import { useExplorerDropRegistry } from "@/features/explorer/drag/ExplorerDragContext";
import { createExplorerDropTargetSpec } from "@/features/explorer/drag/ExplorerDropTarget";

const chromeTabShellClass = [
  "misty-chrome-tabs-shell",
  "flex h-[46px] min-w-0 overflow-hidden",
  "!bg-[var(--misty-files-panel-bg,transparent)]",
].join(" ");

const chromeTabTrayClass = [
  "misty-chrome-tabs-tray",
  "flex h-8 flex-none items-center justify-end gap-0.5 rounded-[11px] p-0.5",
].join(" ");

export const ChromeTabStrip = memo(function ChromeTabStrip(props: ChromeTabStripProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const draggedTabIdRef = useRef<string | null>(null);
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
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tabId);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, destinationTabId: string) => {
      event.preventDefault();
      const sourceTabId =
        draggedTabIdRef.current || event.dataTransfer.getData("text/plain").trim();
      draggedTabIdRef.current = null;
      if (!sourceTabId || sourceTabId === destinationTabId || !props.onReorderTab) return;
      const fromIndex = props.tabs.findIndex((tab) => tab.id === sourceTabId);
      const toIndex = props.tabs.findIndex((tab) => tab.id === destinationTabId);
      if (fromIndex < 0 || toIndex < 0) return;
      props.onReorderTab(sourceTabId, fromIndex, toIndex);
    },
    [props.onReorderTab, props.tabs],
  );

  return (
    <div ref={shellRef} className={chromeTabShellClass}>
      <div
        ref={tabsRef}
        className="misty-chrome-tabs"
        role="tablist"
        aria-label="Open locations"
        onWheel={handleWheel}
      >
        {props.tabs.map((tab) => {
          const active = tab.id === props.activeTabId;
          const canClose = props.canCloseTab ? props.canCloseTab(tab) : true;
          return (
            <div
              key={tab.id}
              className="chrome-tab"
              data-tab-id={tab.id}
              data-active={active ? "true" : "false"}
              draggable={Boolean(props.onReorderTab)}
              onDragEnd={() => {
                draggedTabIdRef.current = null;
              }}
              onDragOver={(event) => {
                if (!props.onReorderTab) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDragStart={(event) => handleDragStart(event, tab.id)}
              onDrop={(event) => handleDrop(event, tab.id)}
            >
              <button
                type="button"
                className="chrome-tab-select"
                role="tab"
                aria-selected={active}
                title={tab.path}
                onClick={() => props.onSelectTab(tab.id)}
              >
                <span className="chrome-tab-title">{tab.title}</span>
              </button>
              {canClose ? (
                <button
                  type="button"
                  className="chrome-tab-close"
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
        <div className="misty-chrome-tabs-toolbar">
          <Button
            type="button"
            className="misty-chrome-tabs-add"
            title="New tab"
            onClick={props.onAddTab}
          >
            <Plus size={17} strokeWidth={2.4} />
          </Button>
        </div>
      </div>
      {props.actions ? <div className={chromeTabTrayClass}>{props.actions}</div> : null}
    </div>
  );
});
