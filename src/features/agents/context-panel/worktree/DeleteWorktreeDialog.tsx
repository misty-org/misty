// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
  Checkbox,
  Skeleton,
  Tooltip,
} from "@/shared/ui";
import { currentSpaceKey, folderOf, useSpaceFolders } from "../../engines/enginesApi";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import { multirunFolderOf } from "../../multirun/multirunFolders";
import { useTerminalStore } from "../terminal/terminalStore";
import { defaultBaseRef, dirNameOf } from "./prInput";
import { worktreeApi, type BranchInfo, type WorktreeInfo } from "./worktreeApi";
import { useWorktreeStore } from "./worktreeStore";
import "./worktree.css";

/** What removing would lose, read before the dialog offers to: `null` while it is read. */
interface Preflight {
  uncommitted: number;
  samples: string[];
  unpushed: number;
  /** Unknown (no branch, or the check failed): no line for it. */
  merged: boolean | null;
}

/** The warning lines for what removing would lose. */
export function warningsFor(
  preflight: Preflight | null,
  branch: string | null,
  base: string,
): string[] {
  if (!preflight) return [];
  const warnings: string[] = [];
  if (preflight.uncommitted > 0) {
    const files = preflight.uncommitted === 1 ? "file has" : "files have";
    const samples = preflight.samples.length ? ` (${preflight.samples.join(", ")})` : "";
    warnings.push(`${preflight.uncommitted} ${files} uncommitted changes${samples}`);
  }
  if (preflight.unpushed > 0) {
    const commits = preflight.unpushed === 1 ? "commit hasn't" : "commits haven't";
    warnings.push(`${preflight.unpushed} ${commits} been pushed`);
  }
  if (preflight.merged === false && branch) {
    warnings.push(
      `Branch ${branch} isn't merged into ${base}. A squash merge also reads as not merged`,
    );
  }
  return warnings;
}

const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");

/**
 * Whether something works in the worktree now: a chat's reply running there (a multi-run lane's,
 * or any chat while the worktree is the Space's folder), or a terminal open in it.
 */
function useWorktreeBusy(path: string, open: boolean): boolean {
  const terminals = useTerminalStore((s) =>
    Object.values(s.tabsByChat).some((tabs) => tabs.some((tab) => samePath(tab.folder, path))),
  );
  const running = useMistyStore((s) => (s.working ? (s.invocationConversationId ?? "") : null));
  const spaceFolder = useSpaceFolders((s) => folderOf(s, currentSpaceKey()));
  const [runHere, setRunHere] = useState(false);
  useEffect(() => {
    if (!open || running === null) {
      setRunHere(false);
      return;
    }
    let live = true;
    void multirunFolderOf(running)
      .catch(() => undefined)
      .then((lane) => {
        const folder = lane ?? spaceFolder;
        if (live) setRunHere(Boolean(folder) && samePath(folder, path));
      });
    return () => {
      live = false;
    };
  }, [open, running, spaceFolder, path]);
  return terminals || runHere;
}

/**
 * Removing a worktree, said plainly: what is uncommitted, unpushed or unmerged is listed first,
 * and the branch stays unless the person ticks it. A reply running there or an open terminal is
 * said too, since removing the folder ends what works in it. The removal runs in the background and the
 * dialog closes at once. A locked worktree can't be removed.
 */
export function DeleteWorktreeDialog({
  folder,
  worktree,
  branches,
  open,
  onOpenChange,
}: {
  /** The linked folder the worktree belongs to. */
  folder: string;
  worktree: WorktreeInfo;
  branches: BranchInfo[];
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const branch = worktree.branch;
  const base = defaultBaseRef(branches, null) ?? "main";
  const [merged, setMerged] = useState<boolean | null | undefined>(undefined);
  const [deleteBranch, setDeleteBranch] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setMerged(undefined);
    if (!branch) {
      setMerged(null);
      return;
    }
    void worktreeApi
      .branchMerged(folder, branch, base)
      .then((value) => live && setMerged(value))
      .catch(() => live && setMerged(null));
    return () => {
      live = false;
    };
  }, [open, folder, branch, base]);

  const preflight: Preflight | null =
    merged === undefined
      ? null
      : {
          uncommitted: worktree.changed ?? 0,
          samples: worktree.samples ?? [],
          unpushed: worktree.ahead ?? 0,
          merged,
        };
  const warnings = warningsFor(preflight, branch, base);
  const busy = useWorktreeBusy(worktree.path, open);
  const name = branch ?? dirNameOf(worktree.path);

  const submit = () => {
    void useWorktreeStore.getState().remove({
      folder,
      space: currentSpaceKey(),
      worktree: worktree.path,
      branch,
      deleteBranch: deleteBranch && branch != null,
    });
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>Remove worktree {name}?</AlertDialogTitle>
        <Tooltip content={worktree.path}>
          <p className="worktree-path">{worktree.path}</p>
        </Tooltip>
        {worktree.locked ? (
          <p role="alert" className="worktree-warning">
            <TriangleAlert size={15} aria-hidden="true" />
            {worktree.lockReason || "Git has locked this worktree, so it can't be removed"}
          </p>
        ) : !preflight ? (
          <div className="grid gap-2" aria-hidden="true">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : warnings.length ? (
          <div className="worktree-warning">
            <TriangleAlert size={15} aria-hidden="true" />
            <ul>
              {warnings.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="worktree-clean">Nothing uncommitted or unpushed.</p>
        )}
        {busy && preflight && !worktree.locked ? (
          <p role="alert" className="worktree-warning">
            <TriangleAlert size={15} aria-hidden="true" />A chat or terminal is working in this
            worktree. Removing it stops that work
          </p>
        ) : null}
        {branch && !worktree.locked ? (
          <label className="worktree-switch">
            <Checkbox
              checked={deleteBranch}
              disabled={!preflight}
              onCheckedChange={(checked) => setDeleteBranch(checked === true)}
            />
            <span>Also delete branch {branch}</span>
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!preflight || worktree.locked} onClick={submit}>
            {deleteBranch && branch ? "Remove worktree and branch" : "Remove worktree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
