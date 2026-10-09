import { useState } from "react";
import { clearNavigationRestoreHistory } from "@/features/navigation-names/clearHistory";
import { Renameable } from "@/features/navigation-names/Renameable";
import { useNavigationNames, windowNameKey } from "@/features/navigation-names/store";
import type { WorkspaceWindow } from "@/features/workspace";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  MenuItem,
  MenuTrigger,
} from "@/shared/ui";
import { AppWindow, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { BrowserProfileDialog, BrowserProfileMenu, type ProfileEdit } from "./BrowserProfileMenu";

export function WorkspaceWindowMenu(props: {
  windows: WorkspaceWindow[];
  activeWindowId: string;
  canReopen: boolean;
  canCloseWindow?: (workspaceWindow: WorkspaceWindow) => boolean;
  onSelect: (windowId: string) => void;
  onCreate: () => void;
  onClose: (windowId: string) => void;
  onReopen: () => void;
}) {
  const [error, setError] = useState("");
  const [profileEdit, setProfileEdit] = useState<ProfileEdit | null>(null);
  const names = useNavigationNames((state) => state.names);
  const canClose = (workspaceWindow: WorkspaceWindow) =>
    props.windows.length > 1 && (!props.canCloseWindow || props.canCloseWindow(workspaceWindow));
  const activeWindow = props.windows.find(
    (workspaceWindow) => workspaceWindow.id === props.activeWindowId,
  );

  return (
    <>
      <BrowserProfileDialog editing={profileEdit} onChange={setProfileEdit} />
      <DropdownMenu>
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-charcoal-border" />
        <MenuTrigger
          iconOnly
          showChevron
          size="xs"
          label="Manage virtual windows"
          title="Manage virtual windows"
          data-tour-target="workspace-window-menu"
          icon={<AppWindow className="size-4" />}
        />
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
                    <IconButton
                      size="2xs"
                      tooltip={false}
                      className="opacity-0 focus-visible:opacity-100 group-hover/window:opacity-100 group-data-[highlighted]/window:opacity-100"
                      label={`Close ${title}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onClose(workspaceWindow.id);
                      }}
                    >
                      <X className="size-3" />
                    </IconButton>
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
          <BrowserProfileMenu onError={setError} onEdit={setProfileEdit} />
          <DropdownMenuSeparator />
          <MenuItem icon={<Plus className="size-4" />} label="New" onSelect={props.onCreate} />
          <MenuItem
            icon={<RotateCcw className="size-4" />}
            label="Reopen"
            disabled={!props.canReopen}
            onSelect={props.onReopen}
          />
          <MenuItem
            icon={<X className="size-4" />}
            label="Close"
            disabled={!activeWindow || !canClose(activeWindow)}
            onSelect={() => props.onClose(props.activeWindowId)}
          />
          <DropdownMenuSeparator />
          <MenuItem
            icon={<Trash2 className="size-4" />}
            label="Clear history"
            onSelect={() =>
              void clearNavigationRestoreHistory().catch((error) => setError(String(error)))
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
