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
  Input,
} from "@/shared/ui";

/**
 * Confirms deleting the account's only sync vault, so a new one can be created.
 * It removes every device's synced data, so a Misty password confirms it (an
 * account with no Misty password, a Google account, has none to give).
 */
export function SyncDeleteVaultDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  needsPassword?: boolean;
  onConfirm(password: string): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  useEffect(() => {
    setBusy(false);
    setError(null);
    setPassword("");
  }, [props.open]);
  const remove = async () => {
    if (busy) return;
    if (props.needsPassword && !password) {
      setError("Enter your Misty password to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm(password);
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
            device are not closed. Then turn on sync again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {props.needsPassword && (
          <Input
            aria-label="Misty password"
            placeholder="Misty password"
            type="password"
            autoComplete="current-password"
            value={password}
            maxLength={1024}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
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
