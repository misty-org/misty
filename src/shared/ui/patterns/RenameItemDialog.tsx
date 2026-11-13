import { useState } from "react";
import { Button } from "../controls/Button";
import { Field } from "../controls/Field";
import { Input } from "../controls/Input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../overlays/Dialog";

export type RenameItemDialogProps = {
  /** What is renamed, e.g. "Rename drawing". */
  title: string;
  initialName: string;
  /** The primary button's label. Default "Save". */
  confirmLabel?: string;
  /** Saves the name. If it throws, its message shows under the field and the dialog stays. */
  onConfirm: (name: string) => Promise<unknown>;
  onClose: () => void;
};

/** What the field says when saving fails: the error's own words, or a plain fallback. */
function failureText(cause: unknown) {
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return message.trim() || "Couldn't save the name. Try again.";
}

/**
 * Renames one item: a small dialog with the name field, then Cancel (quiet) and Save (primary).
 * A failure shows under the field. Mount it with an item-specific key so a draft or a failure
 * never carries over to the next item.
 *
 * ```tsx
 * <RenameItemDialog key={drawing.id} title="Rename drawing" initialName={drawing.title}
 *   onConfirm={(name) => rename(drawing.id, name)} onClose={close} />
 * ```
 */
export function RenameItemDialog({
  title,
  initialName,
  confirmLabel = "Save",
  onConfirm,
  onClose,
}: RenameItemDialogProps) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const empty = !name.trim();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || empty) return;
            setBusy(true);
            setError("");
            try {
              await onConfirm(name.trim());
              onClose();
            } catch (cause) {
              setError(failureText(cause));
              setBusy(false);
            }
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Field label="Name" error={error}>
            <Input
              autoFocus
              value={name}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              onFocus={(event) => event.target.select()}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="quiet" size="lg" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={empty}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
