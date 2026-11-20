import { Check, ChevronDown, ChevronRight, FileText, Minus, Plus, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  cn,
  IconButton,
  Pressable,
  RowTools,
  Surface,
  Text,
  Textarea,
  type TextTone,
} from "@misty/ui";
import { getFileTreeIconSvg } from "../../context-panel/files/fileIcons";
import { useFilesStore } from "../../context-panel/files/filesStore";
import { resolveWorkspaceRepository } from "../../context-panel/files/repositorySelection";
import { ChangesSkeleton } from "../../context-panel/PanelSkeletons";
import {
  absoluteOf,
  ChangesFileMenu,
  openChangedFile,
} from "../../context-panel/git/ChangesFileContextMenu";
import { ChangesPanelHeader } from "../../context-panel/git/ChangesPanelHeader";
import {
  ConfirmDialog,
  NoChangesState,
  NotRepoState,
  StatusErrorState,
} from "../../context-panel/git/ChangesStates";
import { useChangesSelection, useRefreshWhileWorking } from "../../context-panel/git/changesHooks";
import { DiffView } from "../../context-panel/git/DiffView";
import type { GitFileEntry } from "../../context-panel/git/gitApi";
import { useGitStore } from "../../context-panel/git/store";
import { useChangesActions } from "../../context-panel/git/useChangesActions";

/** A changed file as the list shows it; untracked files join the folder's changes, as in VS Code. */
interface Row {
  entry: GitFileEntry;
  staged: boolean;
  untracked: boolean;
}

/** Git's one letter for a file's state, at the row's end. */
function letterOf(row: Row): string {
  if (row.untracked) return "U";
  return { modified: "M", added: "A", deleted: "D", renamed: "R", typechange: "T" }[
    row.entry.status
  ];
}

/** The letter's and the name's color: new green, gone red, changed amber. */
function toneOf(row: Row): TextTone {
  if (row.untracked || row.entry.status === "added") return "added";
  if (row.entry.status === "deleted") return "removed";
  return "changed";
}

/**
 * The Code page's source control, after VS Code's: the commit message and Commit at the top,
 * then "Staged changes" and "Changes", each file one row with its name, its folder faint after
 * it and Git's letter at its end; stage, unstage, discard and open on the row's hover, and the
 * group's on its header's. Commit takes what is staged, or everything when nothing is.
 */
export function SourceControl({ folder }: { folder: string }) {
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
  const statusError = status ? null : (refreshError ?? null);
  const selection = useChangesSelection(status);
  const actions = useChangesActions(repository, status, selection);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  useRefreshWhileWorking(repository);

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
    />
  );

  if (notRepo) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <NotRepoState
          busy={actions.pending.init === true}
          onInit={() => actions.run("init", () => useGitStore.getState().init(repository))}
        />
      </div>
    );
  }

  const staged: Row[] = (status?.staged ?? []).map((entry) => ({
    entry,
    staged: true,
    untracked: false,
  }));
  const changes: Row[] = [
    ...(status?.unstaged ?? []).map((entry) => ({ entry, staged: false, untracked: false })),
    ...(status?.untracked ?? []).map((entry) => ({ entry, staged: false, untracked: true })),
  ];
  const total = staged.length + changes.length;
  const message = actions.commitMsg.trim();
  const committing = actions.pending.commit === true;
  const canCommit = Boolean(message) && total > 0 && !committing;

  // Commit takes what is staged; with nothing staged it stages everything first, as VS Code's
  // smart commit does.
  const commit = () => {
    if (!canCommit) return;
    const everything = staged.length === 0;
    const paths = changes.map((row) => row.entry.path);
    actions.run("commit", async () => {
      const git = useGitStore.getState();
      if (everything) await git.stage(repository, paths);
      await git.commit(repository, message);
      actions.setCommitMsg("");
    });
  };

  const renderRow = (row: Row) => {
    const name = row.entry.path.split("/").pop() ?? row.entry.path;
    const dir = row.entry.path.slice(0, row.entry.path.length - name.length).replace(/\/$/, "");
    const deleted = row.entry.status === "deleted";
    const tone = toneOf(row);
    const path = row.entry.path;
    return (
      <ChangesFileMenu
        key={`${row.staged ? "s" : "c"}:${path}`}
        folder={folder}
        repository={repository}
        entry={row.entry}
        actionKind={row.staged ? "unstage" : "stage"}
        onAction={row.staged ? actions.unstageOne : actions.stageOne}
        onDiscard={row.staged ? undefined : actions.discardRow}
        run={actions.run}
      >
        <Surface
          tone="none"
          radius="md"
          wash="row"
          className="group/row relative flex h-8 w-full min-w-0 items-center gap-1 pr-2 pl-6 text-meta"
        >
          <Pressable
            className="flex h-full min-w-0 flex-1 items-center gap-2"
            onClick={() =>
              row.staged ? actions.openStagedDiff(path) : actions.openUnstagedDiff(path)
            }
          >
            <span
              className="inline-flex size-4 flex-none items-center justify-center"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(name, false) }}
            />
            <Text tone={tone} className={cn("min-w-0 flex-[0_1_auto]", deleted && "line-through")}>
              {name}
            </Text>
            {dir ? (
              <Text size="caption" tone="muted" className="min-w-0 flex-1">
                {dir}
              </Text>
            ) : null}
          </Pressable>
          <RowTools reveal="hover">
            {deleted ? null : (
              <IconButton
                label="Open file"
                onClick={() => openChangedFile(absoluteOf(repository, path))}
              >
                <FileText />
              </IconButton>
            )}
            {row.staged ? null : (
              <IconButton label="Discard changes" onClick={() => actions.discardRow(path)}>
                <Undo2 />
              </IconButton>
            )}
            {row.staged ? (
              <IconButton label="Unstage" onClick={() => actions.unstageOne(path)}>
                <Minus />
              </IconButton>
            ) : (
              <IconButton label="Stage" onClick={() => actions.stageOne(path)}>
                <Plus />
              </IconButton>
            )}
          </RowTools>
          <Text bare tone={tone} weight="medium" className="w-4 flex-none text-center">
            {letterOf(row)}
          </Text>
        </Surface>
      </ChangesFileMenu>
    );
  };

  const section = (props: {
    title: string;
    rows: Row[];
    open: boolean;
    onOpenChange(open: boolean): void;
    staged: boolean;
  }) => {
    const paths = props.rows.map((row) => row.entry.path);
    return (
      <section aria-label={props.title}>
        <Surface
          tone="sidebar"
          className="group/row sticky top-0 z-[var(--stack-above-2)] flex h-8 items-center gap-1 pr-2 pl-1 text-meta"
        >
          <Pressable
            className="flex min-w-0 flex-1 items-center gap-1"
            aria-expanded={props.open}
            onClick={() => props.onOpenChange(!props.open)}
          >
            <Text bare tone="muted" className="flex flex-none">
              {props.open ? <ChevronDown /> : <ChevronRight />}
            </Text>
            <Text tone="default" weight="medium" className="min-w-0">
              {props.title}
            </Text>
          </Pressable>
          <RowTools reveal="hover">
            {props.staged ? (
              <IconButton
                label="Unstage all"
                disabled={actions.pending.unstage === true}
                onClick={() => actions.unstage(paths)}
              >
                <Minus />
              </IconButton>
            ) : (
              <>
                <IconButton label="Discard all" onClick={() => actions.setDiscardTarget(paths)}>
                  <Undo2 />
                </IconButton>
                <IconButton
                  label="Stage all"
                  disabled={actions.pending.stage === true}
                  onClick={() => actions.stage(paths)}
                >
                  <Plus />
                </IconButton>
              </>
            )}
          </RowTools>
          <Badge variant="count">{props.rows.length}</Badge>
        </Surface>
        {props.open ? <div className="flex flex-col px-1">{props.rows.map(renderRow)}</div> : null}
      </section>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {statusError ? (
        <StatusErrorState
          message={statusError}
          busy={actions.pending.retryStatus === true}
          onRetry={() =>
            actions.run("retryStatus", () => useGitStore.getState().refresh(repository, true))
          }
        />
      ) : !status ? (
        <ChangesSkeleton />
      ) : total === 0 ? (
        <NoChangesState />
      ) : (
        <>
          {/* The message and Commit first, as in VS Code. */}
          <div className="flex flex-none flex-col gap-2 px-2 pb-3">
            <Textarea
              aria-label="Commit message"
              className="min-h-9 resize-y"
              placeholder={status.branch ? `Message for ${status.branch}` : "Commit message"}
              rows={1}
              value={actions.commitMsg}
              onChange={(event) => actions.setCommitMsg(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  commit();
                }
              }}
            />
            <div className="grid">
              <Button variant="primary" icon={Check} disabled={!canCommit} onClick={commit}>
                {staged.length ? "Commit" : "Commit all"}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
            {staged.length
              ? section({
                  title: "Staged changes",
                  rows: staged,
                  open: stagedOpen,
                  onOpenChange: setStagedOpen,
                  staged: true,
                })
              : null}
            {changes.length
              ? section({
                  title: "Changes",
                  rows: changes,
                  open: changesOpen,
                  onOpenChange: setChangesOpen,
                  staged: false,
                })
              : null}
          </div>
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
    </div>
  );
}
