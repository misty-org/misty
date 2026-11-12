// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Skeleton } from "@/shared/ui";
import { useFilesStore } from "../files/filesStore";
import { resolveWorkspaceRepository } from "../files/repositorySelection";
import { ChangesFileMenu } from "./ChangesFileContextMenu";
import { ChangesSummary, GroupSection } from "./ChangesGroupSection";
import { ChangesPanelHeader } from "./ChangesPanelHeader";
import {
  CommitFooter,
  ConfirmDialog,
  NoChangesState,
  NotRepoState,
  StatusErrorState,
} from "./ChangesStates";
import { useChangesSelection, useGitViewMode, useRefreshWhileWorking } from "./changesHooks";
import { DiffView } from "./DiffView";
import type { GitFileEntry } from "./gitApi";
import { useGitStore } from "./store";
import { useChangesActions } from "./useChangesActions";
import "./git.css";

/**
 * What changed in the folder, as Git sees it: the branch and its upstream, staged, unstaged and
 * new files as a list or a tree, each file's diff, and a commit of the ticked files. When the
 * file tree has a nested repository selected, the panel follows it.
 */
export function ChangesPanel({ folder }: { folder: string }) {
  const selectedPath = useFilesStore((state) => state.selectedPath);
  const repositories = useFilesStore((state) => state.repositories);
  const repository = useMemo(
    () =>
      resolveWorkspaceRepository({
        selectedPath,
        repositoryRoots: Object.keys(repositories),
        workspacePath: folder,
      }),
    [repositories, selectedPath, folder],
  );
  const status = useGitStore((state) => state.statusByWorkspace[repository]);
  const notRepo = useGitStore((state) => state.notRepoByWorkspace[repository]);
  const refreshError = useGitStore((state) => state.errorByWorkspace[repository]);
  const branches = useGitStore((state) => state.branchesByWorkspace[repository]);
  const diffView = useGitStore((state) => state.diffView);
  // A failed read clears the status, so its reason is the whole body.
  const statusError = status ? null : (refreshError ?? null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const scrollOffset = useRef(0);
  const { viewMode, toggleViewMode } = useGitViewMode();
  const selection = useChangesSelection(status);
  const actions = useChangesActions(repository, status, selection);
  useRefreshWhileWorking(repository);

  useLayoutEffect(() => {
    if (scrollElement) scrollElement.scrollTop = scrollOffset.current;
  }, [scrollElement]);

  if (diffView && diffView.workspacePath === repository) {
    return (
      <DiffView
        workspacePath={repository}
        target={diffView.target}
        status={status}
        onBack={() => useGitStore.getState().closeDiff()}
      />
    );
  }

  const header = (
    <ChangesPanelHeader
      workspacePath={repository}
      followedRepoPath={repository !== folder ? repository : undefined}
      notRepo={notRepo ?? false}
      branch={status?.branch}
      ahead={status?.ahead}
      behind={status?.behind}
      branches={branches}
      pending={actions.pending}
      error={actions.actionError ?? (statusError ? null : refreshError) ?? null}
      run={actions.run}
      onDismissError={actions.dismissError}
      viewMode={viewMode}
      onToggleViewMode={toggleViewMode}
    />
  );

  if (notRepo) {
    return (
      <div className="git-panel">
        {header}
        <NotRepoState
          busy={actions.pending.init === true}
          onInit={() => actions.run("init", () => useGitStore.getState().init(repository))}
        />
      </div>
    );
  }

  const total = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;
  const menu = (actionKind: "stage" | "unstage", onDiscard?: (path: string) => void) =>
    function wrap(entry: GitFileEntry, row: ReactNode) {
      return (
        <ChangesFileMenu
          folder={folder}
          repository={repository}
          entry={entry}
          actionKind={actionKind}
          onAction={actionKind === "stage" ? actions.stageOne : actions.unstageOne}
          onDiscard={onDiscard}
          run={actions.run}
        >
          {row}
        </ChangesFileMenu>
      );
    };

  return (
    <div className="git-panel">
      {header}
      {statusError ? (
        <StatusErrorState
          message={statusError}
          busy={actions.pending.retryStatus === true}
          onRetry={() =>
            actions.run("retryStatus", () => useGitStore.getState().refresh(repository, true))
          }
        />
      ) : (
        <>
          <div
            ref={setScrollElement}
            className="git-scroll"
            onScroll={(event) => {
              scrollOffset.current = event.currentTarget.scrollTop;
            }}
          >
            {!status ? (
              <div className="grid gap-2 p-3" aria-hidden="true">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : total === 0 ? (
              <NoChangesState />
            ) : (
              <>
                <ChangesSummary status={status} selectedCount={selection.selectedFiles.size} />
                <GroupSection
                  scrollElement={scrollElement}
                  scrollOffset={scrollOffset}
                  title="Staged"
                  entries={status.staged}
                  viewMode={viewMode}
                  selectedFiles={selection.selectedFiles}
                  onToggleSelectFile={selection.toggleSelectFile}
                  onToggleSelectMany={selection.toggleSelectMany}
                  groupActionLabel="Unstage all"
                  onGroupAction={actions.unstage}
                  rowActionLabel="Unstage"
                  rowActionKind="unstage"
                  onRowAction={actions.unstageOne}
                  onOpen={actions.openStagedDiff}
                  menu={menu("unstage")}
                  actionBusy={actions.pending.unstage === true}
                />
                <GroupSection
                  scrollElement={scrollElement}
                  scrollOffset={scrollOffset}
                  title="Unstaged"
                  entries={status.unstaged}
                  viewMode={viewMode}
                  selectedFiles={selection.selectedFiles}
                  onToggleSelectFile={selection.toggleSelectFile}
                  onToggleSelectMany={selection.toggleSelectMany}
                  groupActionLabel="Stage all"
                  onGroupAction={actions.stage}
                  rowActionLabel="Stage"
                  rowActionKind="stage"
                  onRowAction={actions.stageOne}
                  rowDiscardLabel="Discard changes"
                  onRowDiscard={actions.discardRow}
                  groupDiscardLabel="Discard all"
                  onGroupDiscard={actions.setDiscardTarget}
                  onOpen={actions.openUnstagedDiff}
                  menu={menu("stage", actions.discardRow)}
                  actionBusy={actions.pending.stage === true}
                />
                <GroupSection
                  scrollElement={scrollElement}
                  scrollOffset={scrollOffset}
                  title="Untracked"
                  entries={status.untracked}
                  viewMode={viewMode}
                  selectedFiles={selection.selectedFiles}
                  onToggleSelectFile={selection.toggleSelectFile}
                  onToggleSelectMany={selection.toggleSelectMany}
                  groupActionLabel="Stage all"
                  onGroupAction={actions.stage}
                  rowActionLabel="Stage"
                  rowActionKind="stage"
                  onRowAction={actions.stageOne}
                  rowDiscardLabel="Discard changes"
                  onRowDiscard={actions.discardRow}
                  groupDiscardLabel="Discard all"
                  onGroupDiscard={actions.setDiscardTarget}
                  onOpen={actions.openUnstagedDiff}
                  menu={menu("stage", actions.discardRow)}
                  actionBusy={actions.pending.stage === true}
                  isNew
                />
              </>
            )}
          </div>
          {/* Nothing to commit, nothing to write a message for. */}
          {total > 0 ? (
            <CommitFooter
              selectedCount={selection.selectedFiles.size}
              busy={actions.pending.commit === true}
              commitMsg={actions.commitMsg}
              onCommitMsgChange={actions.setCommitMsg}
              onCommitSelected={actions.commitSelected}
            />
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={actions.discardTarget !== null}
        title="Discard changes"
        message={
          actions.discardTarget?.length === 1
            ? `Discard the changes to ${actions.discardTarget[0]}? This can't be undone.`
            : `Discard the changes to ${actions.discardTarget?.length ?? 0} files? This can't be undone.`
        }
        confirmLabel="Discard"
        onConfirm={actions.confirmDiscard}
        onCancel={() => actions.setDiscardTarget(null)}
      />
      <ConfirmDialog
        open={actions.pendingCommitPlan !== null}
        title="Commit the ticked files"
        message={
          `Committing only the ticked files first unstages ` +
          `${actions.pendingCommitPlan?.toUnstage.length ?? 0} staged file(s) you left unticked. ` +
          "Their changes stay in the folder."
        }
        confirmLabel="Commit"
        onConfirm={actions.confirmCommitPlan}
        onCancel={() => actions.setPendingCommitPlan(null)}
      />
    </div>
  );
}
