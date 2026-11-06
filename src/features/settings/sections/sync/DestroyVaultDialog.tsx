import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ErrorNotification,
  Input,
  Label,
} from "@/shared/ui";
import { refreshVaultState, vaultNative } from "@/features/vault";

const CONFIRMATION = "DESTROY";

/**
 * Deletes the vault from the server and stops sync everywhere. Every computer keeps what it has.
 * Someone who lost the sync password proves it's them with their account password; a Google
 * account signs in again first.
 */
export function DestroyVaultDialog(props: { open: boolean; onOpenChange(open: boolean): void }) {
  const [usingAccount, setUsingAccount] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setUsingAccount(false);
    setPassword("");
    setConfirmation("");
    setError("");
    setBusy(false);
  }, [props.open]);

  const destroy = () => {
    setBusy(true);
    setError("");
    void vaultNative
      .destroy(usingAccount ? { accountPassword: password } : { vaultPassword: password })
      .then(refreshVaultState)
      .then(() => props.onOpenChange(false))
      .catch((cause: unknown) => {
        setError(typeof cause === "string" ? cause : "That didn't work. Try again.");
        setBusy(false);
      });
  };

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => (busy ? null : props.onOpenChange(open))}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Destroy this vault?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes your synced data from the server and stops sync on every computer. Each one
            keeps what it has.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3.5">
          <div className="grid gap-2">
            <Label htmlFor="destroy-password">
              {usingAccount ? "Misty password" : "Sync password"}
            </Label>
            <Input
              id="destroy-password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            className="justify-self-start"
            disabled={busy}
            onClick={() => {
              setUsingAccount(!usingAccount);
              setPassword("");
            }}
          >
            {usingAccount ? "Use my sync password" : "I forgot my sync password"}
          </Button>
          <div className="grid gap-2">
            <Label htmlFor="destroy-confirm">Type {CONFIRMATION} to confirm</Label>
            <Input
              id="destroy-confirm"
              value={confirmation}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <ErrorNotification message={error} onDismiss={() => setError("")} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy || !password || confirmation !== CONFIRMATION}
            onClick={destroy}
          >
            Destroy vault
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
