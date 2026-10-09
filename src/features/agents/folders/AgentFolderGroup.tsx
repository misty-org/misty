import { useState, type ReactNode } from "react";
import { ChevronRight, Folder, FolderOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@/shared/ui";
import { useAgentFoldersStore, type AgentConversationFolder } from "./agentFoldersStore";
import { FolderNameDialog } from "./FolderNameDialog";

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

/** One folder in an agent's sidebar: a collapsible header over its conversations. */
export function AgentFolderGroup({
  folder,
  count,
  disabled,
  children,
}: {
  folder: AgentConversationFolder;
  count: number;
  disabled: boolean;
  children: ReactNode;
}) {
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
  return (
    <div className="agent-studio-folder" role="group" aria-label={folder.name}>
      <div className="agent-studio-recent-row agent-studio-folder-row">
        <Button
          variant="ghost"
          justify="start"
          aria-expanded={!collapsed}
          title={folder.name}
          onClick={toggle}
        >
          <span className="agent-studio-recent-status">
            <Icon aria-hidden="true" />
          </span>
          <span className="agent-studio-recent-title">{folder.name}</span>
          <span className="agent-studio-folder-count" aria-label={`${count} conversations`}>
            {count || ""}
          </span>
          <ChevronRight className="agent-studio-folder-chevron" aria-hidden="true" />
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton disabled={disabled} label={`More actions for ${folder.name}`}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setAction("rename")}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setError("");
                setAction("delete");
              }}
            >
              <Trash2 /> Delete folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!collapsed && children}
      <FolderNameDialog
        open={action === "rename"}
        title="Rename folder"
        description="Choose a new name for this folder."
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
            The folder is removed. Its conversations move back to Recents and are not deleted.
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting…" : "Delete folder"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
