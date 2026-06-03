import { ShortcutHint } from "@/features/shortcuts";
import type { WorkspaceVirtualWindow } from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { AppWindow, Plus, RotateCcw, X } from "lucide-react";

export function WorkspaceWindowMenu(props: {
  windows: WorkspaceVirtualWindow[];
  activeWindowId: string;
  canReopen: boolean;
  canCloseWindow?: (workspaceWindow: WorkspaceVirtualWindow) => boolean;
  onSelect: (windowId: string) => void;
  onCreate: () => void;
  onClose: (windowId: string) => void;
  onReopen: () => void;
}) {
  const canClose = (workspaceWindow: WorkspaceVirtualWindow) =>
    props.windows.length > 1 && (!props.canCloseWindow || props.canCloseWindow(workspaceWindow));
  const activeWindow = props.windows.find(
    (workspaceWindow) => workspaceWindow.id === props.activeWindowId,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={dockActionClass}
          aria-label="Manage virtual windows"
          title="Manage virtual windows"
        >
          <AppWindow size={18} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {props.windows.map((workspaceWindow, index) => {
          const isActive = workspaceWindow.id === props.activeWindowId;
          return (
            <DropdownMenuItem
              key={workspaceWindow.id}
              onSelect={() => props.onSelect(workspaceWindow.id)}
              className={cn(
                "group/window flex items-center gap-2 pr-1.5",
                isActive && "bg-charcoal-hover text-cream-bright",
              )}
            >
              <span className="w-4 shrink-0 text-right text-[10px] text-cream-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{workspaceWindow.title}</span>
              {canClose(workspaceWindow) ? (
                <button
                  type="button"
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded text-cream-muted opacity-0",
                    "hover:bg-charcoal-active hover:text-cream group-hover/window:opacity-100",
                    "focus:opacity-100",
                  )}
                  aria-label={`Close ${workspaceWindow.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onClose(workspaceWindow.id);
                  }}
                >
                  <X size={11} />
                </button>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={props.onCreate}>
          <Plus size={14} /> New
          <ShortcutHint commandId="workspace.new_virtual_window" className="ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.canReopen} onSelect={props.onReopen}>
          <RotateCcw size={14} /> Reopen
          <ShortcutHint commandId="workspace.reopen_virtual_window" className="ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={!activeWindow || !canClose(activeWindow)}
          onSelect={() => props.onClose(props.activeWindowId)}
        >
          <X size={14} /> Close
          <ShortcutHint commandId="workspace.close_virtual_window" className="ml-auto" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const dockActionClass = [
  "grid size-7 place-items-center rounded text-cream-muted outline-none",
  "hover:bg-charcoal-card hover:text-cream focus:outline-none",
].join(" ");
