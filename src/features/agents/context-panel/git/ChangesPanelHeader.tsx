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
  IconButton,
  Input,
  MenuTrigger,
  PickerList,
  PickerSearch,
  Popover,
  PopoverContent,
  Pressable,
  Separator,
  SidePanelHeader,
  SidePanelLead,
  Skeleton,
  Surface,
  Text,
  Tooltip,
  useNotice,
} from "@/shared/ui";
import type { BranchInfo } from "./gitApi";
import { useGitStore } from "./store";

/** A row of the changes header; the first is the side panel's header row, filling it. */
const headRowClass = "flex min-w-0 flex-1 items-center gap-1";

/** A row of the branch picker: the check column, the name, then where the branch lives. */
const branchRowClass = "flex min-h-7.5 w-full min-w-0 items-center gap-2 rounded-md px-2 text-meta";

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
  useNotice(Boolean(error), { message: error ?? "", tone: "error", onDismiss: onDismissError });

  // Outside a repository nothing here applies: the panel shows only its way to make one.
  if (notRepo && !followedRepoPath) return null;
  // The branch row is the panel's header row; what is left (another repository's name, a new
  // branch's form) stays a quiet row of its own.
  const branchRow = notRepo ? null : (
    <SidePanelHeader>
      <div className={headRowClass}>
        <SidePanelLead>
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
        </SidePanelLead>
        {ahead !== undefined && behind !== undefined ? (
          <Tooltip content={`${ahead} ahead, ${behind} behind`}>
            <Text
              bare
              tone="muted"
              className="flex-none text-micro tabular-nums"
              aria-label={`${ahead} commits ahead, ${behind} behind`}
            >
              ↑{ahead} ↓{behind}
            </Text>
          </Tooltip>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          {onToggleViewMode ? (
            <IconButton
              label={viewMode === "tree" ? "View as list" : "View as tree"}
              onClick={onToggleViewMode}
            >
              {viewMode === "tree" ? <List /> : <FolderTree />}
            </IconButton>
          ) : null}
          <IconButton
            label="Refresh"
            loading={pending.refresh === true}
            disabled={pending.refresh === true}
            onClick={() => run("refresh", () => git().refresh(workspacePath, true))}
          >
            <RefreshCw />
          </IconButton>
          <IconButton
            label="Pull"
            loading={pending.pull === true}
            disabled={pending.pull === true}
            onClick={() => run("pull", () => git().pull(workspacePath))}
          >
            <CloudDownload />
          </IconButton>
          <IconButton
            label="Push"
            loading={pending.push === true}
            disabled={pending.push === true}
            onClick={() => run("push", () => git().push(workspacePath))}
          >
            <CloudUpload />
          </IconButton>
        </div>
      </div>
    </SidePanelHeader>
  );
  const extra = Boolean(followedRepoPath || creatingBranch);
  return (
    <>
      {branchRow}
      {extra ? (
        <div className="flex flex-none flex-col gap-1.5 px-2 pt-1.5 pb-2">
          {followedRepoPath ? (
            <div className={headRowClass}>
              <Tooltip content={followedRepoPath}>
                <Surface
                  as="span"
                  tone="faint"
                  radius="md"
                  className="block max-w-36 overflow-hidden px-1.5 py-px"
                >
                  <Text tone="muted" className="text-micro">
                    {followedRepoPath.split(/[\\/]/).filter(Boolean).pop() ?? followedRepoPath}
                  </Text>
                </Surface>
              </Tooltip>
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
        </div>
      ) : null}
      {extra ? <Separator /> : null}
    </>
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
        value={props.branch ?? ""}
        icon={
          <Text bare tone="muted" className="flex">
            <GitBranch />
          </Text>
        }
        variant="quiet"
        justify="start"
        className="flex-1 [&>[data-text-overflowing]]:flex-1 [&>[data-text-overflowing]]:text-left"
      />
      <PopoverContent
        align="start"
        size="lg"
        kind="flush"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <PickerSearch
          ref={searchRef}
          aria-label="Search branches"
          placeholder="Search branches"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
        <PickerList role="listbox" aria-label="Branches">
          {filtered.map((branch) => {
            const current = branch.name === props.branch;
            return (
              <Pressable
                key={`${branch.isRemote}:${branch.name}`}
                wash="control"
                className={branchRowClass}
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
                <Text bare tone="default" className="flex w-4 flex-none" aria-hidden="true">
                  {current ? <Check /> : null}
                </Text>
                <Text tone="default">{branch.name}</Text>
                {branch.isRemote ? (
                  <Text bare tone="muted" className="flex-none text-micro">
                    Remote
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
          {props.branches && !filtered.length ? (
            <Text as="p" size="meta" tone="muted" className="px-2 py-1.5">
              No matching branches
            </Text>
          ) : null}
          {!props.branches ? (
            // Branch rows as they will be: the check column, then the name.
            <div role="status" aria-label="Branches" aria-busy="true" className="grid">
              {["w-1/2", "w-2/3", "w-2/5", "w-3/5"].map((width) => (
                <div key={width} className="flex h-7.5 items-center gap-2 px-2">
                  <span className="w-4 shrink-0" />
                  <Skeleton className={`h-3 rounded-sm ${width}`} />
                </div>
              ))}
            </div>
          ) : null}
        </PickerList>
        <div className="flex flex-col gap-1 p-1 pt-0">
          <Separator />
          <Pressable wash="control" className={branchRowClass} onClick={props.onCreateBranch}>
            <Text bare tone="default" className="flex w-4 flex-none" aria-hidden="true">
              <Plus />
            </Text>
            <Text tone="default">New branch</Text>
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
      className="flex items-center gap-1 [&>:first-child]:min-w-0 [&>:first-child]:flex-1"
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
      <Button type="submit" disabled={!props.name.trim() || props.busy}>
        Create
      </Button>
      <Button type="button" variant="quiet" onClick={props.onCancel}>
        Cancel
      </Button>
    </form>
  );
}
