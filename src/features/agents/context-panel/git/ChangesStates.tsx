// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { GitBranchPlus, RotateCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  EmptyState,
  ErrorState,
  Textarea,
} from "@/shared/ui";

/**
 * A folder outside any repository: says so, and offers `git init` right there. Nothing else in
 * the panel applies to it, so this is all the panel shows.
 */
export function NotRepoState({ busy, onInit }: { busy: boolean; onInit: () => void }) {
  return (
    <EmptyState
      title="Not a Git repository"
      line="Make this folder a repository to see and commit its changes here."
      action={{
        label: "Initialize repository",
        icon: GitBranchPlus,
        disabled: busy,
        onClick: onInit,
      }}
    />
  );
}

/** The status couldn't be read at all (Git refused the repository's owner, say). The reason
 * lives here rather than in the dismissible notice, so dismissing it never leaves a blank body. */
export function StatusErrorState(props: { message: string; busy: boolean; onRetry: () => void }) {
  return (
    <ErrorState
      title="Couldn't read the changes"
      line={props.message}
      action={{ label: "Try again", icon: RotateCw, disabled: props.busy, onClick: props.onRetry }}
    />
  );
}

/** A repository whose files all match their last commit. */
export function NoChangesState() {
  return (
    <EmptyState title="No changes" line="Everything in this folder matches its last commit." />
  );
}

/** The commit message and button at the panel's foot. */
export function CommitFooter(props: {
  /** Files ticked for this commit. */
  selectedCount: number;
  busy: boolean;
  commitMsg: string;
  onCommitMsgChange: (message: string) => void;
  onCommitSelected: () => void;
}) {
  const disabled = props.selectedCount === 0 || !props.commitMsg.trim() || props.busy;
  return (
    <div className="git-foot">
      <Textarea
        aria-label="Commit message"
        className="min-h-14 resize-y"
        placeholder="Commit message"
        rows={2}
        value={props.commitMsg}
        onChange={(event) => props.onCommitMsgChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !disabled) {
            event.preventDefault();
            props.onCommitSelected();
          }
        }}
      />
      <Button loading={props.busy} disabled={disabled} onClick={props.onCommitSelected}>
        {props.selectedCount > 0 ? `Commit (${props.selectedCount})` : "Commit"}
      </Button>
    </div>
  );
}

/** A question before something that can't be taken back. */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{props.confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
