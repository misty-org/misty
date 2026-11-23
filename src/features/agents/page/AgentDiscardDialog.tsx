import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@misty/ui";

export function AgentDiscardDialog({
  open,
  onCancel,
  onDiscard,
  restoreFocus,
}: {
  open: boolean;
  onCancel(): void;
  onDiscard(): void;
  restoreFocus?(): void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!restoreFocus) return;
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
