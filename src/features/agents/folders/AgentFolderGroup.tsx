import { useRef, useState, type ReactNode } from "react";
import { Folder, FolderOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { globalMistyError } from "@/features/misty/globalMistyActions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
} from "@/shared/ui";
import { useAgentFoldersStore, type AgentConversationFolder } from "./agentFoldersStore";
import { FolderNameDialog } from "./FolderNameDialog";
import { useConversationDrop, type ConversationDrop } from "./useConversationDrop";

const collapsedKey = (id: string) => `misty:agent-folder-collapsed:${id}`;
// Open or closed is a per-device convenience; the folder itself is account state.
const readCollapsed = (id: string) => {
  try {
    return localStorage.getItem(collapsedKey(id)) === "1";
  } catch {
    return false;
  }
};
const writeCollapsed = (id: string, collapsed: boolean) => {
  try {
    if (collapsed) localStorage.setItem(collapsedKey(id), "1");
    else localStorage.removeItem(collapsedKey(id));
  } catch {
    // Storage is optional; the folder still opens and closes for this session.
  }
};

/** One project (a stored conversation folder) in an agent's sidebar: a collapsible header
 * over its conversations, and a drop target for conversations dragged onto it, open or
 * closed. The open or closed folder glyph is its only disclosure cue. */
export function AgentFolderGroup({
  folder,
  count,
  disabled,
  drop,
  children,
}: {
  folder: AgentConversationFolder;
  count: number;
  disabled: boolean;
  drop: ConversationDrop;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useConversationDrop(ref, drop, folder.id);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(folder.id));
  const [action, setAction] = useState<"rename" | "delete">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = () => {
    setCollapsed((value) => {
      writeCollapsed(folder.id, !value);
      return !value;
    });
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await useAgentFoldersStore.getState().remove(folder.id);
      setAction(undefined);
    } catch (failure) {
      setError(globalMistyError(failure));
    } finally {
      setBusy(false);
    }
  };
  const Icon = collapsed ? Folder : FolderOpen;
  const startRename = () => setAction("rename");
  const startDelete = () => {
    setError("");
    setAction("delete");
  };
  const keepDialogFocus = (event: Event) => {
    if (action) event.preventDefault();
  };
  return (
    <div ref={ref} className="agent-studio-folder" role="group" aria-label={folder.name}>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild disabled={disabled}>
          <div className="agent-studio-recent-row agent-studio-folder-row">
            <Button
              variant="ghost"
              justify="start"
              aria-expanded={!collapsed}
              aria-description={`${count} conversation${count === 1 ? "" : "s"}`}
              title={folder.name}
              onClick={toggle}
            >
              <Icon aria-hidden="true" />
              <span className="agent-studio-recent-title">{folder.name}</span>
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton disabled={disabled} label={`More actions for ${folder.name}`}>
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onCloseAutoFocus={keepDialogFocus}>
                <MenuItem icon={<Pencil />} label="Rename" onSelect={startRename} />
                <DropdownMenuSeparator />
                <MenuItem icon={<Trash2 />} label="Delete project" onSelect={startDelete} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={keepDialogFocus}>
          <ContextMenuAction icon={<Pencil />} label="Rename" onSelect={startRename} />
          <ContextMenuSeparator />
          <ContextMenuAction icon={<Trash2 />} label="Delete project" onSelect={startDelete} />
        </ContextMenuContent>
      </ContextMenu>
      {!collapsed && children}
      <FolderNameDialog
        open={action === "rename"}
        title="Rename project"
        description="Choose a new name for this project."
        initialName={folder.name}
        submitLabel="Save"
        onOpenChange={(open) => !open && setAction(undefined)}
        onSubmit={(name) => useAgentFoldersStore.getState().rename(folder.id, name)}
      />
      <AlertDialog
        open={action === "delete"}
        onOpenChange={(open) => !open && !busy && setAction(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete “{folder.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The project is removed. Its conversations move back to Conversations and are not
            deleted.
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting…" : "Delete project"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
