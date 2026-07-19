import { useEffect, useState } from "react";
import { Briefcase, Pencil, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useExplorerStore, type ExplorerWorkspaceEntry } from "../../../stores/useExplorerStore";
import { WorkspaceDialog } from "../../Files/components/ExplorerSidebarSupport";
import type { WorkspaceDialogState } from "../../Files/components/ExplorerSidebarSupport";
import { Button } from "../../../components/ui/button";

type DesktopWorkspacePanelProps = {
  homePath: string;
};

const panelClass =
  "flex max-h-56 min-h-0 min-w-0 flex-col";

const headerClass =
  "mb-2 flex shrink-0 items-center justify-between gap-2 text-sm font-medium text-foreground";

const workspaceRowClass =
  "group/workspace grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch gap-1 rounded-md text-left transition-colors hover:bg-muted/45";

const workspaceOpenButtonClass =
  "grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left";

const workspaceActionButtonClass =
  "grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100";

export function DesktopWorkspacePanel({ homePath }: DesktopWorkspacePanelProps) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const {
    activeWorkspaceId,
    activeWorkspaceTitle,
    createWorkspace,
    deleteWorkspace,
    initialized,
    initialize,
    operationError,
    renameWorkspace,
    selectWorkspace,
    workspaceEntries,
  } = useExplorerStore(
    useShallow((state) => ({
      activeWorkspaceId: state.activeWorkspaceId,
      activeWorkspaceTitle: state.activeWorkspaceTitle,
      createWorkspace: state.createWorkspace,
      deleteWorkspace: state.deleteWorkspace,
      initialized: state.initialized,
      initialize: state.initialize,
      operationError: state.operationError,
      renameWorkspace: state.renameWorkspace,
      selectWorkspace: state.selectWorkspace,
      workspaceEntries: state.workspaceEntries,
    })),
  );

  useEffect(() => {
    if (!initialized) void initialize(homePath);
  }, [homePath, initialized, initialize]);

  const workspaces = workspaceEntries.length > 0
    ? workspaceEntries
    : [{ id: activeWorkspaceId || "workspace_0", title: activeWorkspaceTitle || "Workspace 1" }];

  const openWorkspace = async (workspace: ExplorerWorkspaceEntry) => {
    await selectWorkspace(workspace.id, homePath);
    navigate("/files");
  };

  const addWorkspace = async () => {
    setCreating(true);
    try {
      await createWorkspace("Workspace", homePath);
      navigate("/files");
    } finally {
      setCreating(false);
    }
  };

  const openRenameDialog = (workspace: ExplorerWorkspaceEntry) => {
    setWorkspaceDialog({ kind: "rename", workspaceId: workspace.id, title: workspace.title });
    setWorkspaceDraft(workspace.title);
  };

  const openDeleteDialog = (workspace: ExplorerWorkspaceEntry) => {
    setWorkspaceDialog({ kind: "delete", workspaceId: workspace.id, title: workspace.title });
    setWorkspaceDraft("");
  };

  const closeWorkspaceDialog = () => {
    setWorkspaceDialog(null);
    setWorkspaceDraft("");
  };

  const confirmWorkspaceDialog = () => {
    if (!workspaceDialog) return;
    if (workspaceDialog.kind === "rename") {
      void renameWorkspace(workspaceDialog.workspaceId, workspaceDraft);
    } else if (workspaceDialog.kind === "delete") {
      void deleteWorkspace(workspaceDialog.workspaceId, homePath);
    }
    closeWorkspaceDialog();
  };

  return (
    <section className={panelClass} aria-label="Workspaces">
      <div className={headerClass}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted-foreground">
            <Briefcase className="h-4 w-4" />
          </span>
          <h2 className="truncate">Workspaces</h2>
        </div>
        <Button
          aria-label="Create workspace"
          aria-busy={creating}
          className="size-7 shrink-0"
          disabled={creating}
          onClick={() => void addWorkspace()}
          title="Create workspace"
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="misty-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-1">
          {workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspaceId;
            return (
              <div
                className={`${workspaceRowClass} ${active ? "bg-muted/70" : ""}`}
                key={workspace.id}
              >
                <Button
                  className={`${workspaceOpenButtonClass} h-auto justify-start font-normal hover:bg-transparent`}
                  onClick={() => void openWorkspace(workspace)}
                  type="button"
                  variant="ghost"
                >
                  <span className="grid size-7 place-items-center rounded-md bg-muted/60 text-muted-foreground">
                    <Briefcase className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{workspace.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {active ? "Current workspace" : "Open workspace"}
                    </span>
                  </span>
                </Button>
                <span className="mr-1 flex items-center justify-end gap-1">
                  <Button
                    aria-label={`Rename ${workspace.title}`}
                    className={workspaceActionButtonClass}
                    onClick={() => openRenameDialog(workspace)}
                    title={`Rename ${workspace.title}`}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {workspaceEntries.length > 1 ? (
                    <Button
                      aria-label={`Delete ${workspace.title}`}
                      className={workspaceActionButtonClass}
                      onClick={() => openDeleteDialog(workspace)}
                      title={`Delete ${workspace.title}`}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {operationError ? (
        <p className="mt-2 line-clamp-2 text-xs leading-snug text-destructive" role="alert">{operationError}</p>
      ) : null}
      {workspaceDialog ? (
        <WorkspaceDialog
          state={workspaceDialog}
          value={workspaceDraft}
          onChange={setWorkspaceDraft}
          onConfirm={confirmWorkspaceDialog}
          onCancel={closeWorkspaceDialog}
        />
      ) : null}
    </section>
  );
}
