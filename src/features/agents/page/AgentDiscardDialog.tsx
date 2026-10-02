import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/shared/ui";

/** Confirms leaving unsaved agent edits or an unsent message. */
export function AgentDiscardDialog({
  open,
  onCancel,
  onDiscard,
  restoreFocus,
}: {
  open: boolean;
  onCancel(): void;
  onDiscard(): void;
  /** Returns focus to whichever control started the change. */
  restoreFocus(): void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
        <AlertDialogDescription>
          You have unsaved changes or an unsent message.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>Discard and switch</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
