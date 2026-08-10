import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  AccountDeletionBlockedError,
  beginAccountDeletion,
  type AccountDeletionResponse,
} from "../../api";
import { customRowClass } from "../../components/SettingsRows";

const CONFIRMATION = "DELETE";

export function DangerZone({ onDeleted }: { onDeleted: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [blockedSpaces, setBlockedSpaces] = useState<string[]>([]);
  const [result, setResult] = useState<AccountDeletionResponse | null>(null);

  const ready = password.length > 0 && confirmation === CONFIRMATION;

  async function confirmDelete() {
    if (working || !ready) return;
    setWorking(true);
    setError("");
    setBlockedSpaces([]);
    try {
      const response = await beginAccountDeletion(password, confirmation);
      setResult(response);
      setConfirmOpen(false);
      onDeleted();
    } catch (deleteError) {
      setConfirmOpen(false);
      if (deleteError instanceof AccountDeletionBlockedError) {
        // The server refuses while the account still owns Spaces; naming them
        // is the only way the visitor can act on it.
        setBlockedSpaces(deleteError.spaces.map((space) => space.name));
        setError(deleteError.message);
      } else {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : "Could not request deletion.",
        );
      }
    } finally {
      setWorking(false);
    }
  }

  if (result) {
    return (
      <div className={`${customRowClass} flex flex-col gap-2`}>
        <p className="text-sm text-foreground" role="status">
          Deletion requested.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your account is scheduled for deletion. It stays recoverable for 30
          days if you sign in again and cancel.
        </p>
      </div>
    );
  }

  return (
    <div className={`${customRowClass} flex flex-col gap-3`}>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Deleting your account removes your profile, private files, and Space
        memberships after a 30-day recovery window. This cannot be undone once
        the window closes.
      </p>

      <div className="grid gap-3">
        <div>
          <label
            htmlFor="account-delete-password"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Password
          </label>
          <Input
            id="account-delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="account-delete-confirmation"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Type {CONFIRMATION} to confirm
          </label>
          <Input
            id="account-delete-confirmation"
            type="text"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="destructive"
          disabled={!ready || working}
          aria-busy={working}
          onClick={() => setConfirmOpen(true)}
        >
          {working ? <Spinner aria-hidden="true" /> : null}
          Delete my account
        </Button>
      </div>

      {blockedSpaces.length > 0 ? (
        <ul className="list-disc pl-5 text-xs text-[var(--settings-warning)]">
          {blockedSpaces.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive" role="status">
          {error}
        </p>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your Misty account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your account is scheduled for deletion and stays recoverable for 30
              days. After that it is permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my account</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
