import { useEffect, useState } from "react";
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

/** Confirms deleting the account's only sync vault, so a new one can be created. */
export function SyncDeleteVaultDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [props.open]);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm();
      props.onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The sync vault could not be deleted. Try again.",
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
          <AlertDialogTitle>Delete sync vault?</AlertDialogTitle>
          <AlertDialogDescription>
            Synced data is removed from the server and every device stops syncing. Tabs open on this
            device are not closed. Then create a new vault with a new password and secret.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="m-0 text-sm text-cream" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            {busy ? "Deleting…" : "Delete vault"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
