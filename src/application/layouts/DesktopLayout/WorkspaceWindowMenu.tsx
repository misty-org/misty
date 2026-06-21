import { useState } from "react";
import { clearNavigationRestoreHistory } from "@/features/navigation-names/clearHistory";
import type { WorkspaceVirtualWindow } from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { AppWindow, Plus, RotateCcw, Trash2, X } from "lucide-react";

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
  const [error, setError] = useState("");
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
          data-tour-target="workspace-window-menu"
        >
          <AppWindow size={18} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60 min-w-0 max-w-[calc(100vw-16px)] gap-0 p-1.5 font-[system-ui] text-[13px]"
      >
        {props.windows.map((workspaceWindow) => {
          const isActive = workspaceWindow.id === props.activeWindowId;
          return (
            <DropdownMenuItem
              key={workspaceWindow.id}
              onSelect={() => props.onSelect(workspaceWindow.id)}
              className={cn(
                menuItemClass,
                "group/window",
                isActive && "bg-charcoal-hover text-cream-bright",
              )}
            >
              <AppWindow className="size-[15px]" />
              <span className="min-w-0 flex-1 truncate">{workspaceWindow.title}</span>
              {canClose(workspaceWindow) ? (
                <button
                  type="button"
                  className={cn(
                    "grid size-[18px] shrink-0 place-items-center rounded text-cream-muted opacity-0",
                    "hover:bg-charcoal-active hover:text-cream group-hover/window:opacity-100",
                    "group-data-[highlighted]/window:opacity-100",
                    "focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cream-muted",
                  )}
                  aria-label={`Close ${workspaceWindow.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onClose(workspaceWindow.id);
                  }}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        {error && (
          <p role="alert" className="p-2 text-xs text-cream">
            {error}
          </p>
        )}
        <DropdownMenuSeparator className="mx-0 my-[5px]" />
        <DropdownMenuItem className={menuItemClass} onSelect={props.onCreate}>
          <Plus className="size-[15px]" /> New
        </DropdownMenuItem>
        <DropdownMenuItem
          className={menuItemClass}
          disabled={!props.canReopen}
          onSelect={props.onReopen}
        >
          <RotateCcw className="size-[15px]" /> Reopen
        </DropdownMenuItem>
        <DropdownMenuItem
          className={menuItemClass}
          disabled={!activeWindow || !canClose(activeWindow)}
          onSelect={() => props.onClose(props.activeWindowId)}
        >
          <X className="size-[15px]" /> Close
        </DropdownMenuItem>
        <DropdownMenuSeparator className="mx-0 my-[5px]" />
        <DropdownMenuItem
          className={menuItemClass}
          onSelect={() =>
            void clearNavigationRestoreHistory().catch((error) => setError(String(error)))
          }
        >
          <Trash2 className="size-[15px]" /> Clear history
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const menuItemClass =
  "min-h-8 min-w-0 cursor-pointer gap-2 rounded-[5px] px-[9px] py-[7px] text-[13px] leading-[18px] data-[disabled]:opacity-40";

const dockActionClass = [
  "grid size-7 place-items-center rounded text-cream-muted outline-none",
  "hover:bg-charcoal-card hover:text-cream focus:outline-none focus-visible:ring-1 focus-visible:ring-cream-muted",
].join(" ");
