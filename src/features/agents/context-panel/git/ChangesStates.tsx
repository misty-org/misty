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
  Separator,
  Textarea,
} from "@misty/ui";

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

export function StatusErrorState(props: { message: string; busy: boolean; onRetry: () => void }) {
  return (
    <ErrorState
      title="Couldn't read the changes"
      line={props.message}
      action={{ label: "Try again", icon: RotateCw, disabled: props.busy, onClick: props.onRetry }}
    />
  );
}

export function NoChangesState() {
  return (
    <EmptyState title="No changes" line="Everything in this folder matches its last commit." />
  );
}

export function CommitFooter(props: {
  selectedCount: number;
  busy: boolean;
  commitMsg: string;
  onCommitMsgChange: (message: string) => void;
  onCommitSelected: () => void;
}) {
  const disabled = props.selectedCount === 0 || !props.commitMsg.trim() || props.busy;
  return (
    <>
      <Separator />
      <div className="flex flex-none flex-col gap-2 p-2">
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
        <Button disabled={disabled || props.busy} onClick={props.onCommitSelected}>
          {props.selectedCount > 0 ? `Commit (${props.selectedCount})` : "Commit"}
        </Button>
      </div>
    </>
  );
}

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
