import { useEffect, useState, type FormEvent } from "react";
import { isAccountUnauthorizedError } from "@/api/account/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@/shared/ui";

/**
 * Chooses the Misty password that sync is encrypted with. The server is sent
 * only values derived on this device, so it never learns the new password. A
 * Google account has no Misty password to confirm, so it asks only for a new one.
 */
export function SyncPasswordDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  google: boolean;
  onSubmit(current: string, next: string): Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCurrent("");
    setNext("");
    setConfirmation("");
    setBusy(false);
    setError(null);
  }, [props.open]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!props.google && !current) {
      setError("Enter your current password.");
      return;
    }
    if (!next) {
      setError("Enter a new password.");
      return;
    }
    if (next !== confirmation) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit(current, next);
      props.onOpenChange(false);
    } catch (cause) {
      setError(
        isAccountUnauthorizedError(cause)
          ? "Your current password is wrong."
          : cause instanceof Error && cause.message
            ? cause.message
            : "The password could not be changed. Try again.",
      );
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={(open) => !busy && props.onOpenChange(open)}>
      <DialogContent className="max-w-[460px] gap-0 p-6">
        <DialogTitle className="text-base font-semibold text-cream-bright">
          {props.google ? "Choose a sync password" : "Choose a new Misty password"}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm leading-relaxed text-cream-muted">
          {props.google
            ? "This password encrypts your synced data. Misty cannot recover it for you."
            : "Your new password encrypts your synced data on this device. Misty never receives it, and cannot recover it for you."}
        </DialogDescription>
        <form onSubmit={submit} className="ph-no-capture mt-5 grid gap-3" data-private="true">
          {!props.google && (
            <Input
              aria-label="Current password"
              placeholder="Current password"
              type="password"
              autoComplete="current-password"
              value={current}
              disabled={busy}
              onChange={(event) => setCurrent(event.target.value)}
            />
          )}
          <Input
            aria-label="New password"
            placeholder="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            maxLength={1024}
            disabled={busy}
            onChange={(event) => setNext(event.target.value)}
          />
          <Input
            aria-label="Confirm new password"
            placeholder="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            maxLength={1024}
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-cream">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
