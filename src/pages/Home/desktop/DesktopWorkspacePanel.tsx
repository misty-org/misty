import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Briefcase, Pencil, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useExplorerStore, type ExplorerWorkspaceEntry } from "../../../stores/useExplorerStore";
import { WorkspaceDialog } from "../../Files/components/ExplorerSidebarSupport";
import type { WorkspaceDialogState } from "../../Files/components/ExplorerSidebarSupport";

type DesktopWorkspacePanelProps = {
  homePath: string;
};

const panelClass =
  "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0d10]/95 p-4 shadow-2xl shadow-black/25 xl:col-span-4 xl:col-start-1 xl:row-span-3 xl:row-start-1";

const workspaceRowClass =
  "group/workspace grid w-full min-w-0 grid-cols-[minmax(0,1fr)_64px] items-stretch gap-1 rounded-xl border border-transparent text-left transition hover:border-white/[0.08] hover:bg-white/[0.045]";

const workspaceOpenButtonClass =
  "grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-xl border-0 bg-transparent px-2.5 py-2 text-left";

const workspaceActionButtonClass =
  "grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-transparent bg-transparent p-0 text-text-muted opacity-0 transition hover:bg-white/[0.06] hover:text-text group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100";

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
    <div className={panelClass}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.055] text-text-muted">
            <Briefcase className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 truncate text-sm font-bold text-text">Workspaces</h2>
            <p className="m-0 mt-0.5 truncate text-[11px] text-text-muted">{activeWorkspaceTitle || "Workspace 1"}</p>
          </div>
        </div>
        <button
          aria-label="Create workspace"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-text-muted transition hover:border-white/20 hover:bg-white/[0.06] hover:text-text disabled:opacity-50"
          disabled={creating}
          onClick={() => void addWorkspace()}
          title="Create workspace"
          type="button"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="misty-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-1">
          {workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspaceId;
            return (
              <div
                className={`${workspaceRowClass} ${active ? "border-white/[0.12] bg-white/[0.07]" : ""}`}
                key={workspace.id}
              >
                <button
                  className={workspaceOpenButtonClass}
                  onClick={() => void openWorkspace(workspace)}
                  type="button"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.045] text-text-muted">
                    <Briefcase className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-text">{workspace.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                      {active ? "Current workspace" : "Open workspace"}
                    </span>
                  </span>
                </button>
                <span className="mr-1 flex items-center justify-end gap-1">
                  <button
                    aria-label={`Rename ${workspace.title}`}
                    className={workspaceActionButtonClass}
                    onClick={() => openRenameDialog(workspace)}
                    title={`Rename ${workspace.title}`}
                    type="button"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {workspaceEntries.length > 1 ? (
                    <button
                      aria-label={`Delete ${workspace.title}`}
                      className={workspaceActionButtonClass}
                      onClick={() => openDeleteDialog(workspace)}
                      title={`Delete ${workspace.title}`}
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {operationError ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-[#fca5a5]">{operationError}</p>
      ) : null}
      {workspaceDialog ? createPortal(
        <WorkspaceDialog
          state={workspaceDialog}
          value={workspaceDraft}
          onChange={setWorkspaceDraft}
          onConfirm={confirmWorkspaceDialog}
          onCancel={closeWorkspaceDialog}
        />,
        document.body,
      ) : null}
    </div>
  );
}
