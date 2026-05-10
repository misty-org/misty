import type { DockDropZone, WorkspacePane, WorkspaceTab } from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  MoreHorizontal,
} from "lucide-react";

export function WorkspacePaneMenu(props: {
  tab: WorkspaceTab;
  pane: WorkspacePane;
  otherPanes: WorkspacePane[];
  canSplitSideways: boolean;
  canSplitVertically: boolean;
  onMove: (tabId: string, paneId: string) => boolean;
  onDock: (tabId: string, paneId: string, zone: DockDropZone) => boolean;
  onSwap: (targetPaneId: string) => boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={dockActionClass}
          aria-label="Arrange panel"
          title="Arrange panel"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[210px]">
        <DropdownMenuLabel>Dock active tab</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!props.canSplitSideways}
          onSelect={() => props.onDock(props.tab.id, props.pane.id, "left")}
        >
          <ArrowLeftToLine size={13} /> Split left
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!props.canSplitSideways}
          onSelect={() => props.onDock(props.tab.id, props.pane.id, "right")}
        >
          <ArrowRightToLine size={13} /> Split right
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!props.canSplitVertically}
          onSelect={() => props.onDock(props.tab.id, props.pane.id, "up")}
        >
          <ArrowUpToLine size={13} /> Split above
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!props.canSplitVertically}
          onSelect={() => props.onDock(props.tab.id, props.pane.id, "down")}
        >
          <ArrowDownToLine size={13} /> Split below
        </DropdownMenuItem>
        {props.otherPanes.length ? <DropdownMenuSeparator /> : null}
        {props.otherPanes.map((pane, index) => (
          <DropdownMenuItem key={pane.id} onSelect={() => props.onMove(props.tab.id, pane.id)}>
            Move tab to panel {index + 1}
          </DropdownMenuItem>
        ))}
        {props.otherPanes.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Arrange whole panel</DropdownMenuLabel>
          </>
        ) : null}
        {props.otherPanes.map((pane, index) => (
          <DropdownMenuItem key={`swap:${pane.id}`} onSelect={() => props.onSwap(pane.id)}>
            <ArrowLeftRight size={13} /> Swap with panel {index + 1}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const dockActionClass = [
  "grid size-7 place-items-center rounded text-cream-muted outline-none",
  "hover:bg-charcoal-card hover:text-cream focus:outline-none disabled:pointer-events-none disabled:opacity-35",
].join(" ");
