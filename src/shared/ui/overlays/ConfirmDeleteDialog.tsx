import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as React from "react";
import { Button } from "../controls/Button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./AlertDialog";

export type ConfirmDeleteOptions = {
  /** What goes, as a question: `Delete "Q3 notes"?` */
  title: string;
  /** One line: what is lost and that it can't be undone. */
  what: string;
  /** The danger button's label; "Delete" unless the action is "Remove" or "Discard". */
  confirmLabel?: string;
  /**
   * Does the delete. While it runs the button shows a spinner; if it throws, the error shows in
   * the dialog and the dialog stays open so it can be tried again.
   */
  onConfirm?: () => void | Promise<void>;
};

export type ConfirmDeleteDialogProps = ConfirmDeleteOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rare extra content above the buttons, such as a field to type the name into. */
  children?: React.ReactNode;
  /** Keeps Delete off until the extra content is filled in. */
  confirmDisabled?: boolean;
};

/** What the dialog says when a delete fails: the error's own words, or a plain fallback. */
function failureText(error: unknown, label: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim() || `Couldn't ${label.toLowerCase()}. Try again.`;
}

/**
 * Every delete asks first in this small dialog: what goes, then Cancel (quiet) and the danger
 * Delete. There is no corner ×; Escape and Cancel close it.
 *
 * `<ConfirmDeleteDialog open={open} onOpenChange={setOpen} title={`Delete "${name}"?`}
 *   what="The note and its history are deleted for everyone in the Space." onConfirm={remove} />`
 */
function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  what,
  confirmLabel = "Delete",
  onConfirm,
  children,
  confirmDisabled = false,
}: ConfirmDeleteDialogProps) {
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState("");
  const errorId = React.useId();
  const alive = React.useRef(true);
  React.useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  React.useEffect(() => {
    if (!open) {
      setError("");
      setRunning(false);
    }
  }, [open]);

  const confirm = async () => {
    if (running) return;
    setError("");
    setRunning(true);
    try {
      await onConfirm?.();
      if (!alive.current) return;
      setRunning(false);
      onOpenChange(false);
    } catch (failure) {
      if (!alive.current) return;
      setRunning(false);
      setError(failureText(failure, confirmLabel));
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // A delete in flight finishes before the dialog can go.
        if (!next && running) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent data-slot="confirm-delete-dialog" size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{what}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error ? (
          <p id={errorId} role="alert" className="text-meta text-danger">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogPrimitive.Cancel asChild>
            <Button type="button" variant="quiet" size="lg" disabled={running}>
              Cancel
            </Button>
          </AlertDialogPrimitive.Cancel>
          {/* Not an AlertDialog Action: that would close the dialog before the delete is done. */}
          <Button
            type="button"
            variant="danger"
            size="lg"
            loading={running}
            disabled={confirmDisabled}
            aria-describedby={error ? errorId : undefined}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type PendingConfirm = ConfirmDeleteOptions & { resolve: (confirmed: boolean) => void };

/**
 * The same dialog for call sites that ask in the middle of a handler. Render `dialog` once in the
 * component; `confirm(options)` opens it and resolves true once the delete is done (or, without
 * `onConfirm`, once Delete is chosen), and false when it is cancelled.
 *
 * ```tsx
 * const { confirm, dialog } = useConfirmDelete();
 * const onDelete = async () => {
 *   if (await confirm({ title: `Delete "${name}"?`, what: "This can't be undone.", onConfirm: remove })) close();
 * };
 * return <>{menu}{dialog}</>;
 * ```
 */
function useConfirmDelete() {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);
  const [open, setOpen] = React.useState(false);
  const pendingRef = React.useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  // A dialog left open when its owner goes away counts as cancelled.
  React.useEffect(() => () => pendingRef.current?.resolve(false), []);

  const confirm = React.useCallback((options: ConfirmDeleteOptions) => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        resolve(confirmed);
      };
      setPending({ ...options, resolve: settle });
      setOpen(true);
    });
  }, []);

  const dialog = pending ? (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) pending.resolve(false);
      }}
      title={pending.title}
      what={pending.what}
      confirmLabel={pending.confirmLabel}
      onConfirm={async () => {
        await pending.onConfirm?.();
        pending.resolve(true);
      }}
    />
  ) : null;

  return { confirm, dialog };
}

export { ConfirmDeleteDialog, useConfirmDelete };
