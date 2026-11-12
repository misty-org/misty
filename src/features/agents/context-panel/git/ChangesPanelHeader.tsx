// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import {
  Check,
  CloudDownload,
  CloudUpload,
  FolderTree,
  GitBranch,
  List,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ErrorNotification,
  IconButton,
  Input,
  MenuTrigger,
  Popover,
  PopoverContent,
  Pressable,
  Skeleton,
  Spinner,
} from "@/shared/ui";
import type { BranchInfo } from "./gitApi";
import { useGitStore } from "./store";

interface ChangesPanelHeaderProps {
  workspacePath: string;
  /** Set when the panel follows the file tree into a repository other than the folder's own,
   * so it's clear which repository staging, committing, pulling and pushing act on. */
  followedRepoPath?: string;
  notRepo: boolean;
  branch: string | undefined;
  /** Commits ahead of and behind the upstream; undefined hides them. */
  ahead: number | undefined;
  behind: number | undefined;
  branches: BranchInfo[] | undefined;
  pending: Record<string, true>;
  /** The first error to show: a failed action, else the last refresh's failure. */
  error: string | null;
  run: (key: string, action: () => Promise<unknown>) => void;
  onDismissError: () => void;
  viewMode?: "flat" | "tree";
  onToggleViewMode?: () => void;
}

/** The branch, how far it is from its upstream, and Git's actions; then the branch picker. */
export function ChangesPanelHeader({
  workspacePath,
  followedRepoPath,
  notRepo,
  branch,
  ahead,
  behind,
  branches,
  pending,
  error,
  run,
  onDismissError,
  viewMode,
  onToggleViewMode,
}: ChangesPanelHeaderProps) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const git = useGitStore.getState;

  return (
    <div className="git-head">
      <div className="git-head-row">
        {notRepo ? null : (
          <BranchPicker
            workspacePath={workspacePath}
            branch={branch}
            branches={branches}
            run={run}
            open={branchOpen}
            onOpenChange={setBranchOpen}
            query={branchQuery}
            onQueryChange={setBranchQuery}
            onCreateBranch={() => {
              setBranchOpen(false);
              setCreatingBranch(true);
            }}
          />
        )}
        {ahead !== undefined && behind !== undefined ? (
          <span
            className="git-sync"
            title={`${ahead} ahead, ${behind} behind`}
            aria-label={`${ahead} commits ahead, ${behind} behind`}
          >
            ↑{ahead} ↓{behind}
          </span>
        ) : null}
        <div className="git-head-actions">
          {onToggleViewMode ? (
            <IconButton
              label={viewMode === "tree" ? "View as list" : "View as tree"}
              size="xs"
              onClick={onToggleViewMode}
            >
              {viewMode === "tree" ? <List /> : <FolderTree />}
            </IconButton>
          ) : null}
          <IconButton
            label="Refresh"
            size="xs"
            disabled={pending.refresh === true}
            onClick={() => run("refresh", () => git().refresh(workspacePath, true))}
          >
            {pending.refresh ? <Spinner className="size-3.5" /> : <RefreshCw />}
          </IconButton>
          <IconButton
            label="Pull"
            size="xs"
            disabled={notRepo || pending.pull === true}
            onClick={() => run("pull", () => git().pull(workspacePath))}
          >
            {pending.pull ? <Spinner className="size-3.5" /> : <CloudDownload />}
          </IconButton>
          <IconButton
            label="Push"
            size="xs"
            disabled={notRepo || pending.push === true}
            onClick={() => run("push", () => git().push(workspacePath))}
          >
            {pending.push ? <Spinner className="size-3.5" /> : <CloudUpload />}
          </IconButton>
        </div>
      </div>
      {followedRepoPath ? (
        <div className="git-head-row">
          <span className="git-repo-badge" title={followedRepoPath}>
            {followedRepoPath.split(/[\\/]/).filter(Boolean).pop() ?? followedRepoPath}
          </span>
        </div>
      ) : null}
      {creatingBranch ? (
        <NewBranchForm
          name={newBranchName}
          busy={pending.createBranch === true}
          onNameChange={setNewBranchName}
          onSubmit={(name) =>
            run("createBranch", async () => {
              await git().createBranch(workspacePath, name);
              setCreatingBranch(false);
              setNewBranchName("");
            })
          }
          onCancel={() => {
            setCreatingBranch(false);
            setNewBranchName("");
          }}
        />
      ) : null}
      <ErrorNotification message={error ?? ""} onDismiss={onDismissError} />
    </div>
  );
}

/** The branch button, a popover to search and switch, and its "New branch" row. */
function BranchPicker(props: {
  workspacePath: string;
  branch: string | undefined;
  branches: BranchInfo[] | undefined;
  run: (key: string, action: () => Promise<unknown>) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onCreateBranch: () => void;
}) {
  const { open, onQueryChange } = props;
  const searchRef = useRef<HTMLInputElement>(null);

  // A filter from last time doesn't carry into the next opening.
  useEffect(() => {
    if (!open) onQueryChange("");
  }, [open, onQueryChange]);

  const filtered = useMemo(() => {
    const query = props.query.trim().toLowerCase();
    return (props.branches ?? []).filter(
      (branch) => !query || branch.name.toLowerCase().includes(query),
    );
  }, [props.branches, props.query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        props.onOpenChange(next);
        // Branches change outside the panel too (a checkout in a terminal); read them each time.
        if (next) void useGitStore.getState().loadBranches(props.workspacePath);
      }}
    >
      <MenuTrigger
        kind="popover"
        label="Branch"
        icon={<GitBranch size={14} aria-hidden="true" />}
        value={props.branch ?? ""}
        variant="outline"
        className="git-branch-trigger"
      />
      <PopoverContent
        align="start"
        className="git-branches p-1.5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <Input
          ref={searchRef}
          aria-label="Search branches"
          placeholder="Search branches"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
        <div className="git-branch-list" role="listbox" aria-label="Branches">
          {filtered.map((branch) => {
            const current = branch.name === props.branch;
            return (
              <Pressable
                key={`${branch.isRemote}:${branch.name}`}
                className="git-branch-row"
                role="option"
                aria-selected={current}
                onClick={() => {
                  props.onOpenChange(false);
                  // Which branch is current comes from the status, like the button's label.
                  if (!current) {
                    props.run("checkout", () =>
                      useGitStore.getState().checkout(props.workspacePath, branch.name),
                    );
                  }
                }}
              >
                <span className="git-branch-check" aria-hidden="true">
                  {current ? <Check size={14} /> : null}
                </span>
                <span>{branch.name}</span>
                {branch.isRemote ? <span className="git-branch-remote">Remote</span> : null}
              </Pressable>
            );
          })}
          {props.branches && !filtered.length ? (
            <p className="git-branch-empty">No matching branches</p>
          ) : null}
          {!props.branches ? (
            <div className="grid gap-2 p-2" aria-hidden="true">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ) : null}
        </div>
        <div className="git-branch-foot">
          <Pressable className="git-branch-row" onClick={props.onCreateBranch}>
            <span className="git-branch-check" aria-hidden="true">
              <Plus size={14} />
            </span>
            <span>New branch</span>
          </Pressable>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The new branch's name, under the head. */
function NewBranchForm(props: {
  name: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <form
      className="git-new-branch"
      onSubmit={(event) => {
        event.preventDefault();
        const name = props.name.trim();
        if (!name || props.busy) return;
        props.onSubmit(name);
      }}
    >
      <Input
        ref={inputRef}
        aria-label="Branch name"
        placeholder="Branch name"
        value={props.name}
        onChange={(event) => props.onNameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onCancel();
        }}
      />
      <Button type="submit" size="sm" disabled={!props.name.trim() || props.busy}>
        Create
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>
        Cancel
      </Button>
    </form>
  );
}
