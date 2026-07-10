import { useState } from "react";
import { clearNavigationRestoreHistory } from "@/features/navigation-names/clearHistory";
import { Renameable } from "@/features/navigation-names/Renameable";
import { useNavigationNames, windowNameKey } from "@/features/navigation-names/store";
import type { WorkspaceVirtualWindow } from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
  Button,
} from "@/shared/ui";
import { AppWindow, ChevronDown, Plus, RotateCcw, Trash2, X } from "lucide-react";

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
  const names = useNavigationNames((state) => state.names);
  const canClose = (workspaceWindow: WorkspaceVirtualWindow) =>
    props.windows.length > 1 && (!props.canCloseWindow || props.canCloseWindow(workspaceWindow));
  const activeWindow = props.windows.find(
    (workspaceWindow) => workspaceWindow.id === props.activeWindowId,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="none"
          className={dockActionClass}
          aria-label="Manage virtual windows"
          title="Manage virtual windows"
          data-tour-target="workspace-window-menu"
        >
          <AppWindow className="size-4" />
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-16px)]">
        {props.windows.map((workspaceWindow) => {
          const isActive = workspaceWindow.id === props.activeWindowId;
          const nameKey = windowNameKey(workspaceWindow.id);
          const title = names[nameKey] ?? workspaceWindow.title;
          return (
            <Renameable
              key={workspaceWindow.id}
              portalEditor={false}
              nameKey={nameKey}
              automatic={workspaceWindow.title}
            >
              <DropdownMenuItem
                onSelect={() => props.onSelect(workspaceWindow.id)}
                className={cn("group/window", isActive && "text-cream-bright")}
              >
                <AppWindow className="size-4" />
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {canClose(workspaceWindow) ? (
                  <Button
                    variant="ghost"
                    size="none"
                    className={cn(
                      "grid size-[18px] shrink-0 place-items-center rounded border-0 text-cream-muted opacity-0",
                      " hover:text-cream group-hover/window:opacity-100",
                      "group-data-[highlighted]/window:opacity-100",
                      "focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cream-muted",
                    )}
                    aria-label={`Close ${title}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      props.onClose(workspaceWindow.id);
                    }}
                  >
                    <X className="size-3" />
                  </Button>
                ) : null}
              </DropdownMenuItem>
            </Renameable>
          );
        })}
        {error && (
          <p role="alert" className="p-2 text-xs text-cream">
            {error}
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={props.onCreate}>
          <Plus className="size-4" /> New
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!props.canReopen} onSelect={props.onReopen}>
          <RotateCcw className="size-4" /> Reopen
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!activeWindow || !canClose(activeWindow)}
          onSelect={() => props.onClose(props.activeWindowId)}
        >
          <X className="size-4" /> Close
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            void clearNavigationRestoreHistory().catch((error) => setError(String(error)))
          }
        >
          <Trash2 className="size-4" /> Clear history
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const dockActionClass = [
  "flex h-7 shrink-0 items-center justify-center gap-1 px-1.5 rounded text-cream-muted outline-none",
  " hover:text-cream focus:outline-none focus-visible:ring-1 focus-visible:ring-cream-muted",
].join(" ");
