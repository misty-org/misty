import { useState } from "react";
import type { ExplorerSidebarProps } from "@/models/interfaces/features/explorer/components/ExplorerSidebar";
import type { ExplorerWorkspaceEntry } from "@/models/interfaces/features/explorer/store/types";
import type { WorkspaceDialogState } from "@/models/types/features/explorer/components/ExplorerSidebarSupport";

/**
 * The workspace switcher menu and its create/rename/delete dialog.
 *
 * All three actions share one dialog, so `kind` decides which of the parent's
 * callbacks fires on confirm.
 */
export function useSidebarWorkspaceMenu(sidebar: ExplorerSidebarProps) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState("");

  const openWorkspaceDialog = (
    kind: "create" | "rename" | "delete",
    target?: ExplorerWorkspaceEntry,
  ) => {
    const active =
      target ??
      sidebar.workspaceEntries.find((workspace) => workspace.id === sidebar.activeWorkspaceId) ??
      (sidebar.activeWorkspaceId
        ? { id: sidebar.activeWorkspaceId, title: sidebar.activeWorkspaceTitle }
        : null);
    setWorkspaceMenuOpen(false);
    setWorkspaceDialog(
      kind === "rename" && active
        ? { kind, workspaceId: active.id, title: active.title }
        : kind === "delete" && active
          ? { kind, workspaceId: active.id, title: active.title }
          : { kind: "create", workspaceId: "", title: "File layout" },
    );
    setWorkspaceDraft(kind === "rename" && active ? active.title : "File layout");
  };

  const confirmWorkspaceDialog = () => {
    if (!workspaceDialog) return;
    if (workspaceDialog.kind === "create") {
      sidebar.onCreateWorkspace(workspaceDraft);
    } else if (workspaceDialog.kind === "rename") {
      sidebar.onRenameWorkspace(workspaceDialog.workspaceId, workspaceDraft);
    } else {
      sidebar.onDeleteWorkspace(workspaceDialog.workspaceId);
    }
    setWorkspaceDialog(null);
    setWorkspaceDraft("");
  };

  return {
    workspaceMenuOpen,
    setWorkspaceMenuOpen,
    workspaceDialog,
    setWorkspaceDialog,
    workspaceDraft,
    setWorkspaceDraft,
    openWorkspaceDialog,
    confirmWorkspaceDialog,
  };
}
