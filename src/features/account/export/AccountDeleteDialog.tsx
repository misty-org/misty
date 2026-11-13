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
  useNotice,
} from "@/shared/ui";
import GoogleSignInButton from "../components/GoogleSignInButton";
import {
  accountDeletionError,
  requestAccountDeletion,
  type AccountExportProof,
} from "./accountExport";

const CONFIRMATION = "DELETE";

/**
 * Deletes the signed-in account after the person types DELETE and confirms it is them: their
 * Misty password, or a fresh Google sign-in for a Google account. `onDeleted` runs once the
 * server has accepted it, so the caller can end the session.
 */
export function AccountDeleteDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  email: string;
  google: boolean;
  onDeleted(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    setBusy(false);
    setError("");
    setPassword("");
    setConfirmation("");
  }, [props.open]);
  const confirmed = confirmation === CONFIRMATION;
  const run = async (proof: AccountExportProof) => {
    setBusy(true);
    setError("");
    try {
      await requestAccountDeletion(proof);
      props.onOpenChange(false);
      props.onDeleted();
    } catch (cause) {
      setError(accountDeletionError(cause));
    } finally {
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
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            Your profile, files and Space memberships are removed after 30 days.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          aria-label={`Type ${CONFIRMATION} to confirm`}
          placeholder={`Type ${CONFIRMATION} to confirm`}
          autoComplete="off"
          spellCheck={false}
          value={confirmation}
          disabled={busy}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        {props.google ? (
          <GoogleSignInButton
            disabled={busy || !confirmed}
            onBusy={setBusy}
            onSuccess={() => undefined}
            onError={setError}
            reauthenticate={(token) => run({ reauthenticationToken: token })}
          />
        ) : (
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
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep my account</AlertDialogCancel>
          {props.google ? null : (
            <AlertDialogAction
              disabled={!confirmed || !password}
              loading={busy}
              onClick={(event) => {
                event.preventDefault();
                void run({ password });
              }}
            >
              Delete account
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
