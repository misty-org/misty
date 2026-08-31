import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui";
import { useEffect, useState } from "react";

type JournalDocumentKind = "drawing" | "note";

export function JournalDeleteDialog(props: {
  kind: JournalDocumentKind;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = props.kind === "drawing" ? "drawing" : "note";

  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [props.kind, props.open, props.title]);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm();
      props.onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : `This ${label} could not be deleted. Try again.`,
      );
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!busy) props.onOpenChange(open);
      }}
    >
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {label}?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            “{props.title || `Untitled ${label}`}” will be permanently deleted. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="m-0 text-sm text-notification-red" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-notification-red text-white hover:bg-notification-red/90"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
