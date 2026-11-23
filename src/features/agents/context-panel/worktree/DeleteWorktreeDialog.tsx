// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
  Checkbox,
  Skeleton,
  Surface,
  Text,
  Tooltip,
} from "@misty/ui";
import { currentSpaceKey } from "../../engines/engines_api";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { multirunFolderOf } from "../../multirun/multirun_folders";
import { useChatFolders } from "../../shared-folders/chat_folder";
import { useTerminalStore } from "../terminal/terminal_store";
import { defaultBaseRef, dirNameOf } from "./pr_input";
import { worktreeApi, type BranchInfo, type WorktreeInfo } from "./worktree_api";
import { useWorktreeStore } from "./worktree_store";

interface Preflight {
  uncommitted: number;
  samples: string[];
  unpushed: number;
  merged: boolean | null;
}

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

function Warning({ alert = false, children }: { alert?: boolean; children: ReactNode }) {
  return (
    <Surface
      tone="faint"
      radius="lg"
      role={alert ? "alert" : undefined}
      className="flex items-start gap-2 px-3 py-2.5"
    >
      <Text bare tone="waiting" className="mt-0.5 flex flex-none">
        <TriangleAlert aria-hidden="true" />
      </Text>
      <Text bare as="div" size="meta" tone="default" className="min-w-0">
        {children}
      </Text>
    </Surface>
  );
}

const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");

function useWorktreeBusy(path: string, open: boolean): boolean {
  const terminals = useTerminalStore((s) =>
    Object.values(s.tabsByChat).some((tabs) => tabs.some((tab) => samePath(tab.folder, path))),
  );
  const running = useMistyStore((s) => (s.working ? (s.invocationConversationId ?? "") : null));
  const chatFolder = useChatFolders((s) => (running ? s.byConversation[running]?.path : undefined));
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
        const folder = lane ?? chatFolder;
        if (live) setRunHere(Boolean(folder) && samePath(folder ?? "", path));
      });
    return () => {
      live = false;
    };
  }, [open, running, chatFolder, path]);
  return terminals || runHere;
}

export function DeleteWorktreeDialog({
  folder,
  worktree,
  branches,
  open,
  onOpenChange,
}: {
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
          <Text as="p" size="caption" tone="muted">
            {worktree.path}
          </Text>
        </Tooltip>
        {worktree.locked ? (
          <Warning alert>
            {worktree.lockReason || "Git has locked this worktree, so it can't be removed"}
          </Warning>
        ) : !preflight ? (
          <Skeleton className="h-10 rounded-lg" />
        ) : warnings.length ? (
          <Warning>
            <ul className="grid gap-0.5">
              {warnings.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Warning>
        ) : (
          <Text wrap size="meta" tone="muted">
            Nothing uncommitted or unpushed.
          </Text>
        )}
        {busy && preflight && !worktree.locked ? (
          <Warning alert>
            A chat or terminal is working in this worktree. Removing it stops that work
          </Warning>
        ) : null}
        {branch && !worktree.locked ? (
          <Text bare as="label" size="meta" tone="default" className="flex items-center gap-2.5">
            <Checkbox
              checked={deleteBranch}
              disabled={!preflight}
              onCheckedChange={(checked) => setDeleteBranch(checked === true)}
            />
            <span>Also delete branch {branch}</span>
          </Text>
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
