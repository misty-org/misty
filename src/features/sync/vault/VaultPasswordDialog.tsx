import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorNotification,
  Input,
  Label,
  Spinner,
} from "@/shared/ui";
import { vaultNative } from "./native";
import { refreshVaultState } from "./useVaultState";

export type VaultPasswordMode = "create" | "unlock" | "change";

const copy: Record<VaultPasswordMode, { title: string; about: string; action: string }> = {
  create: {
    title: "Sync this browser",
    about:
      "Your tabs, sign-ins and bookmarks follow you to every computer, encrypted with a password " +
      "only you know. It's separate from your Misty password, and Misty can't recover it.",
    action: "Create vault",
  },
  unlock: {
    title: "Enter your sync password",
    about: "Your tabs, sign-ins and bookmarks from your other computers will appear here.",
    action: "Continue",
  },
  change: {
    title: "Change sync password",
    about: "Your other computers keep syncing. Misty can't recover this password.",
    action: "Change password",
  },
};

function failure(cause: unknown): string {
  return typeof cause === "string"
    ? cause
    : cause instanceof Error
      ? cause.message
      : "That didn't work.";
}

/** The one place a sync password is typed: creating the vault, opening it here, or changing it. */
export function VaultPasswordDialog(props: {
  mode: VaultPasswordMode;
  open: boolean;
  /** What leaving says: "Not now" is an answer the first time, "Cancel" otherwise. */
  dismissLabel: string;
  onDismiss(): void;
  onDone(): void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const choosing = props.mode !== "unlock";
  const text = copy[props.mode];

  useEffect(() => {
    setPassword("");
    setConfirmation("");
    setError("");
    setBusy(false);
  }, [props.open, props.mode]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (choosing && password !== confirmation) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (props.mode === "create") await vaultNative.create(password);
      else if (props.mode === "unlock") await vaultNative.unlock(password);
      else await vaultNative.changePassword(password);
      await refreshVaultState();
      props.onDone();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => (!open && !busy ? props.onDismiss() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.about}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3.5" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="vault-password">
              {props.mode === "change" ? "New password" : "Password"}
            </Label>
            <Input
              id="vault-password"
              type="password"
              autoFocus
              autoComplete={choosing ? "new-password" : "current-password"}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {choosing ? (
            <div className="grid gap-2">
              <Label htmlFor="vault-password-confirm">Confirm password</Label>
              <Input
                id="vault-password-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
          ) : null}
          <ErrorNotification message={error} onDismiss={() => setError("")} />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={props.onDismiss}>
              {props.dismissLabel}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !password || (choosing && !confirmation)}
              aria-busy={busy}
            >
              {busy ? <Spinner size="sm" label={false} /> : null}
              {text.action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
