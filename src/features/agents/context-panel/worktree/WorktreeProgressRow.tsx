// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { X } from "lucide-react";
import { Button, IconButton, Spinner, Text, Tooltip } from "@/shared/ui";
import { useWorktreeStore, type PendingCreation } from "./worktreeStore";

/** Each fixed failure code the native side sends, as words. */
const ERROR_TEXT: Record<string, string> = {
  pr_not_found:
    "The pull request doesn't exist, was closed and its ref removed, or the remote isn't GitHub",
  fetch_failed: "Fetching failed. Check your connection and try again",
  branch_exists: "That branch already exists",
  dir_exists: "The folder for it already exists",
  branch_checked_out: "That branch is already checked out in another worktree",
  branch_not_found: "That branch doesn't exist",
  base_not_found: "The branch to start from doesn't exist",
  not_a_repo: "This folder isn't a Git repository",
  invalid_branch: "That isn't a valid branch name",
  invalid_args: "Choose a branch to start from",
  register_failed: "The worktree was made but couldn't be linked. Trying again uses it as it is",
  sparse_checkout_empty:
    "Sparse checkout rules leave out every file, so nothing was checked out. " +
    "Run git sparse-checkout disable, or change the rules, and try again",
  unknown: "The worktree couldn't be made. Try again",
};

/** A creation's one line in the worktree menu, as tall as a worktree's row. */
const rowClass = "flex h-8 min-w-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-meta";

/** Why a creation failed: the native wording where the code alone says too little. */
function failureReason(pending: PendingCreation): string {
  if (pending.stage === "canceled") return "Cancelled";
  const ownWords = ["add_failed", "repo_open_failed", "fetch_failed"];
  if ((!pending.errorKind || ownWords.includes(pending.errorKind)) && pending.error) {
    return pending.error;
  }
  if (pending.errorKind) return ERROR_TEXT[pending.errorKind] ?? ERROR_TEXT.unknown;
  return ERROR_TEXT.unknown;
}

function stageText(pending: PendingCreation): string {
  switch (pending.stage) {
    case "fetch":
      return `Fetching ${pending.detail ?? ""}`.trim();
    case "add":
      return `Making ${pending.branch}`;
    case "register":
      return `Linking ${pending.branch}`;
    default:
      return `Checking ${pending.branch}`;
  }
}

/** A creation in the worktree menu: a spinner, its stage and a cancel button, then a retry
 * row once it failed or was cancelled. One line in every state, so rows below never move. */
export function WorktreeProgressRow({ pending }: { pending: PendingCreation }) {
  const cancel = useWorktreeStore((s) => s.cancel);
  const retry = useWorktreeStore((s) => s.retry);
  const dismiss = useWorktreeStore((s) => s.dismiss);
  const failed = pending.stage === "failed" || pending.stage === "canceled";

  if (failed) {
    const line = `${pending.branch} wasn't made: ${failureReason(pending)}`;
    return (
      <div role="alert" className={rowClass}>
        <Tooltip content={line}>
          <Text tone="failed" className="flex-1">
            {line}
          </Text>
        </Tooltip>
        <Button type="button" variant="quiet" size="sm" onClick={() => retry(pending.creationId)}>
          Retry
        </Button>
        <IconButton label="Dismiss" size="sm" onClick={() => dismiss(pending.creationId)}>
          <X aria-hidden="true" />
        </IconButton>
      </div>
    );
  }

  return (
    <div className={rowClass}>
      <Text bare tone="muted" className="flex shrink-0">
        <Spinner size="sm" label={false} />
      </Text>
      <Text tone="muted" className="flex-1">
        {stageText(pending)}
      </Text>
      <IconButton label="Cancel" size="sm" onClick={() => cancel(pending.creationId)}>
        <X aria-hidden="true" />
      </IconButton>
    </div>
  );
}
