import { useEffect, useRef, useState } from "react";
import { Renameable } from "@/features/navigation-names/Renameable";
import { useNavigationNames, windowNameKey } from "@/features/navigation-names/store";
import { windowColorHex } from "@/features/workspace/windowColors";
import type { WorkspaceWindow } from "@/features/workspace";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  IconButton,
  MenuItem,
  MenuTrigger,
} from "@/shared/ui";
import { AppWindow, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { registerWindowColorAnchor, useWindowColorRequest } from "./windowColorRequest";
import { BrowserProfileDialog, BrowserProfileMenu, type ProfileEdit } from "./BrowserProfileMenu";

const reopenLabel = "Reopen";
const noClosedWindows: WorkspaceWindow[] = [];
const hoverActionClass =
  "opacity-0 focus-visible:opacity-100 group-hover/window:opacity-100 group-data-[highlighted]/window:opacity-100";

/** The window's color as a dot, or the window glyph for one made before colors. */
function WindowDot({ color }: { color: WorkspaceWindow["color"] }) {
  return color ? (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-full"
      style={{ backgroundColor: windowColorHex(color) }}
    />
  ) : (
    <AppWindow className="size-4" />
  );
}

type WorkspaceWindowMenuProps = {
  windows: WorkspaceWindow[];
  activeWindowId: string;
  canReopen: boolean;
  canCloseWindow?: (workspaceWindow: WorkspaceWindow) => boolean;
  onSelect: (windowId: string) => void;
  onCreate: () => void;
  onClose: (windowId: string) => void;
  /** Reopens the named closed window, or the most recent one. */
  onReopen: (windowId?: string) => void;
};

/**
 * The virtual window menu's rows, and the profile dialog they open. The rows go inside any
 * dropdown content; the dialog sits outside it so it outlives the menu closing.
 */
export function useWorkspaceWindowMenu(props: WorkspaceWindowMenuProps) {
  const [error, setError] = useState("");
  // The menu closes before the picker opens beside its trigger.
  const askColor = (
    request: Parameters<ReturnType<typeof useWindowColorRequest.getState>["ask"]>[0],
  ) => window.setTimeout(() => useWindowColorRequest.getState().ask(request), 0);
  const [profileEdit, setProfileEdit] = useState<ProfileEdit | null>(null);
  const names = useNavigationNames((state) => state.names);
  const canClose = (workspaceWindow: WorkspaceWindow) =>
    props.windows.length > 1 && (!props.canCloseWindow || props.canCloseWindow(workspaceWindow));
  const closedWindows = useWorkspaceStore(
    (state) => state.closedWindowsByScope[state.activeScopeKey] ?? noClosedWindows,
  );
  const dialog = <BrowserProfileDialog editing={profileEdit} onChange={setProfileEdit} />;
  const items = (
    <>
      <BrowserProfileMenu onError={setError} onEdit={setProfileEdit} />
      <DropdownMenuSeparator />
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
              <WindowDot color={workspaceWindow.color} />
              <span className="min-w-0 flex-1 truncate">{title}</span>
              <IconButton
                size="2xs"
                tooltip={false}
                className={hoverActionClass}
                label={`Edit ${title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  askColor({ kind: "edit", windowId: workspaceWindow.id });
                }}
              >
                <Pencil className="size-3" />
              </IconButton>
              {canClose(workspaceWindow) ? (
                <IconButton
                  size="2xs"
                  tooltip={false}
                  className={hoverActionClass}
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
      <MenuItem
        icon={<Plus className="size-4" />}
        label="New"
        onSelect={() => window.setTimeout(props.onCreate, 0)}
      />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!closedWindows.length}>
          <RotateCcw className="size-4" />
          <span className="min-w-0 flex-1 truncate">{reopenLabel}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56 max-w-[calc(100vw-16px)]">
          {closedWindows.map((closed) => (
            <DropdownMenuItem key={closed.id} onSelect={() => props.onReopen(closed.id)}>
              <WindowDot color={closed.color} />
              <span className="min-w-0 flex-1 truncate">
                {names[windowNameKey(closed.id)] ?? closed.title}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
  return { dialog, items };
}

export function WorkspaceWindowMenu(props: WorkspaceWindowMenuProps) {
  const anchor = useRef<HTMLSpanElement | null>(null);
  useEffect(() => registerWindowColorAnchor(anchor.current), []);
  const { dialog, items } = useWorkspaceWindowMenu(props);
  return (
    <>
      {dialog}
      <DropdownMenu>
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-charcoal-border" />
        <span ref={anchor} className="inline-flex">
          <MenuTrigger
            iconOnly
            showChevron
            size="xs"
            label="Manage virtual windows"
            title="Manage virtual windows"
            icon={<AppWindow className="size-4" />}
          />
        </span>
        <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-16px)]">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
