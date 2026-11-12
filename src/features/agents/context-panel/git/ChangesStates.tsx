// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
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
  Textarea,
} from "@/shared/ui";

/** A folder outside any repository: says so, and offers `git init` right there. */
export function NotRepoState({ busy, onInit }: { busy: boolean; onInit: () => void }) {
  return (
    <div className="git-empty">
      <p>This folder isn't a Git repository.</p>
      <Button size="sm" variant="secondary" disabled={busy} aria-busy={busy} onClick={onInit}>
        Initialize repository
      </Button>
    </div>
  );
}

/** The status couldn't be read at all (Git refused the repository's owner, say). The reason
 * lives here rather than in the dismissible notice, so dismissing it never leaves a blank body. */
export function StatusErrorState(props: { message: string; busy: boolean; onRetry: () => void }) {
  return (
    <div className="git-empty" data-error>
      <p role="alert">{props.message}</p>
      <Button
        size="sm"
        variant="secondary"
        disabled={props.busy}
        aria-busy={props.busy}
        onClick={props.onRetry}
      >
        Try again
      </Button>
    </div>
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
      <Button size="sm" disabled={disabled} onClick={props.onCommitSelected}>
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
