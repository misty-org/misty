import { useId, useState } from "react";
import { Button } from "../controls/Button";
import { Input } from "../controls/Input";
import { Label } from "../controls/Label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../overlays/Dialog";

/** Mount with an item-specific key so drafts and failures never carry between items. */
export function CollectionItemDialog({
  title,
  description,
  initialName,
  actionLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  initialName?: string;
  actionLabel: string;
  onConfirm: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initialName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rename = initialName !== undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-w-sm"
        aria-describedby={description ? `${id}-description` : undefined}
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || (rename && !name.trim())) return;
            setBusy(true);
            setError("");
            try {
              await onConfirm(name.trim());
              onClose();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "Could not save the change. Try again.",
              );
              setBusy(false);
            }
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription id={`${id}-description`}>{description}</DialogDescription>
            )}
          </DialogHeader>
          {rename && (
            <div className="space-y-2">
              <Label htmlFor={id}>Name</Label>
              <Input
                id={id}
                autoFocus
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={rename ? "primary" : "destructive"}
              disabled={busy || (rename && !name.trim())}
            >
              {busy ? "Saving…" : actionLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
