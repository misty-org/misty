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
import GoogleSignInButton from "./components/GoogleSignInButton";
import {
  accountExportError,
  requestAccountExport,
  saveAccountExport,
  type AccountExportProof,
} from "./accountExport";

/**
 * Exports the signed-in account (`POST /me/export`) after the person confirms it is them: their
 * Misty password, or a fresh Google sign-in for a Google account. The export is saved as one JSON
 * file with the account's data and a short-lived link to each note, drawing and file.
 */
export function AccountExportDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  email: string;
  google: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    setBusy(false);
    setError("");
    setPassword("");
    setSaved("");
  }, [props.open]);
  const run = async (proof: AccountExportProof) => {
    setBusy(true);
    setError("");
    try {
      setSaved(saveAccountExport(await requestAccountExport(props.email, proof)));
    } catch (cause) {
      setError(accountExportError(cause));
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
          <AlertDialogTitle>Export account</AlertDialogTitle>
          <AlertDialogDescription>
            Misty saves one file with your account's data and a link to each note, drawing and file.
            The links work for 15 minutes. Library files can also be downloaded from the Library.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {props.google ? (
          <GoogleSignInButton
            disabled={busy}
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
        {error ? (
          <p className="m-0 text-sm text-cream" role="alert">
            {error}
          </p>
        ) : saved ? (
          <p className="m-0 text-sm text-cream-muted" role="status">
            Saved {saved} to your downloads.
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{saved ? "Done" : "Cancel"}</AlertDialogCancel>
          {props.google ? null : (
            <AlertDialogAction
              disabled={busy || !password}
              onClick={(event) => {
                event.preventDefault();
                void run({ password });
              }}
            >
              {busy ? "Exporting…" : "Export"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
