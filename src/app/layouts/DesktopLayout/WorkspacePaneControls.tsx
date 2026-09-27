import { liftPanePresentation } from "@/features/workspace/paneDragPresentation";
import { useLayoutEffect, useRef, useState } from "react";
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
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  IconButton,
  MenuItem,
  MenuTrigger,
  Portal,
} from "@/shared/ui";

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
      <Portal>
        <div
          style={bounds}
          data-visible={hovered || open}
          className={cn(
            "pointer-events-none fixed layer-blocking-popup flex items-center gap-0.5",
            "rounded-md border border-charcoal-border bg-charcoal-card p-0.5",
            "opacity-0 transition-opacity data-[visible=true]:pointer-events-auto",
            "data-[visible=true]:opacity-100 hover:pointer-events-auto",
            "hover:opacity-100 has-[:focus-visible]:pointer-events-auto",
            "has-[:focus-visible]:opacity-100",
            "[@media(hover:none)]:pointer-events-auto",
            "[@media(hover:none)]:opacity-100",
          )}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <IconButton
            size="xs"
            tooltip={false}
            className="cursor-grab touch-none active:cursor-grabbing"
            data-reorder-handle
            label="Drag pane"
            title="Drag pane to an edge to move, or center to swap"
            onPointerDown={drag}
          >
            <Move className="size-3.5" size={14} />
          </IconButton>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <MenuTrigger
              iconOnly
              size="xs"
              label="Arrange pane"
              title="Arrange pane"
              icon={<LayoutPanelTop className="size-3.5" size={14} />}
            />
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
                <MenuItem
                  key={direction}
                  icon={<Icon />}
                  label={label}
                  onSelect={() => useWorkspaceStore.getState().movePane(pane.id, direction)}
                />
              ))}
              <DropdownMenuSeparator />
              {panes.map((target, index) =>
                target.id === pane.id ? null : (
                  <MenuItem
                    key={target.id}
                    icon={<ArrowLeftRight />}
                    label={`Swap with pane ${index + 1}: ${
                      target.tabs.find((tab) => tab.id === target.activeTabId)?.title ?? "Empty"
                    }`}
                    onSelect={() => useWorkspaceStore.getState().swapPanes(pane.id, target.id)}
                  />
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            size="xs"
            tooltip={false}
            label="Close pane"
            title="Close pane"
            onClick={onClose}
          >
            <X className="size-3" size={12} />
          </IconButton>
        </div>
      </Portal>
    </>
  );
}
