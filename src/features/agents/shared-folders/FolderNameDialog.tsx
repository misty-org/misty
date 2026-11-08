import { useEffect, useState } from "react";
import { globalMistyError } from "../conversations/state/globalMistyActions";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  ErrorNotification,
  Input,
} from "@/shared/ui";

/** Names a new project or renames one. Stays open with the error if saving fails. */
export function FolderNameDialog({
  open,
  title,
  initialName = "",
  submitLabel,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initialName?: string;
  submitLabel: string;
  onOpenChange(open: boolean): void;
  onSubmit(name: string): Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setError("");
  }, [open, initialName]);
  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(name.trim());
      onOpenChange(false);
    } catch (failure) {
      setError(globalMistyError(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{title}</DialogTitle>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            aria-label="Project name"
            value={name}
            maxLength={80}
            disabled={busy}
            autoFocus
            onFocus={(event) => event.target.select()}
            onChange={(event) => setName(event.target.value)}
          />
          <ErrorNotification message={error} onDismiss={() => setError("")} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
