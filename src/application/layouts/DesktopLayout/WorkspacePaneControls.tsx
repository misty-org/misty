import { liftPanePresentation } from "@/features/workspace/paneDragPresentation";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Move,
  LayoutPanelTop,
  X,
} from "lucide-react";
import { dockLeaves, useWorkspaceStore, type WorkspacePane } from "@/features/workspace";
import { usePointerDrag } from "@/shared/hooks/usePointerReorder";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";

const controlClass =
  "grid size-6 shrink-0 place-items-center rounded text-cream-muted hover:bg-charcoal-hover hover:text-cream focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cream-muted";

export function WorkspacePaneControls({
  pane,
  onClose,
}: {
  pane: WorkspacePane;
  onClose: () => void;
}) {
  const root = useWorkspaceStore((state) => state.layout.root);
  const panes = dockLeaves(root);
  const drag = usePointerDrag(
    {
      id: pane.id,
      paneId: pane.id,
      label: pane.tabs.find((tab) => tab.id === pane.activeTabId)?.title ?? "Pane",
      scope: "workspace-panes",
    },
    () => liftPanePresentation(root, pane.id),
  );
  const anchor = useRef<HTMLSpanElement>(null);
  const [bounds, setBounds] = useState({ top: 0, right: 0 });
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const paneElement = anchor.current?.closest<HTMLElement>("[data-workspace-pane]");
    if (!paneElement) return;
    const update = () => {
      const rect = paneElement.getBoundingClientRect();
      setBounds({
        top: Math.max(4, rect.top - 14),
        right: Math.max(4, window.innerWidth - rect.right + 4),
      });
    };
    const move = (event: PointerEvent) => {
      const rect = paneElement.getBoundingClientRect();
      setHovered(
        rect.width > 0 &&
          rect.height > 0 &&
          event.clientX >= rect.right - 112 &&
          event.clientX <= rect.right + 4 &&
          event.clientY >= rect.top - 20 &&
          event.clientY <= rect.top + 44,
      );
    };
    const leave = () => setHovered(false);
    update();
    const observer = new ResizeObserver(update);
    for (let element: HTMLElement | null = paneElement; element; element = element.parentElement)
      observer.observe(element);
    window.addEventListener("pointermove", move);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [root]);
  if (panes.length < 2) return null;
  return (
    <>
      <span ref={anchor} className="pointer-events-none absolute right-0 top-0" aria-hidden />
      {createPortal(
        <div
          style={bounds}
          data-visible={hovered || open}
          className="pointer-events-none fixed z-[2147483300] flex items-center gap-0.5 rounded-md border border-charcoal-border bg-charcoal-card p-0.5 opacity-0 transition-opacity data-[visible=true]:pointer-events-auto data-[visible=true]:opacity-100 hover:pointer-events-auto hover:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={`${controlClass} cursor-grab touch-none active:cursor-grabbing`}
            data-reorder-handle
            aria-label="Drag pane"
            title="Drag pane to an edge to move, or center to swap"
            onPointerDown={drag}
          >
            <Move size={14} />
          </button>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={controlClass}
                aria-label="Arrange pane"
                title="Arrange pane"
              >
                <LayoutPanelTop size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move pane to workspace edge</DropdownMenuLabel>
              {(
                [
                  ["left", "Push left", ArrowLeftToLine],
                  ["right", "Push right", ArrowRightToLine],
                  ["up", "Push above", ArrowUpToLine],
                  ["down", "Push below", ArrowDownToLine],
                ] as const
              ).map(([direction, label, Icon]) => (
                <DropdownMenuItem
                  key={direction}
                  onSelect={() => {
                    useWorkspaceStore.getState().movePane(pane.id, direction);
                  }}
                >
                  <Icon size={14} />
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {panes.map((target, index) =>
                target.id === pane.id ? null : (
                  <DropdownMenuItem
                    key={target.id}
                    onSelect={() => {
                      useWorkspaceStore.getState().swapPanes(pane.id, target.id);
                    }}
                  >
                    <ArrowLeftRight size={14} />
                    Swap with pane {index + 1}:{" "}
                    {target.tabs.find((tab) => tab.id === target.activeTabId)?.title ?? "Empty"}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className={controlClass}
            aria-label="Close pane"
            title="Close pane"
            onClick={onClose}
          >
            <X size={12} />
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
