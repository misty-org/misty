import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui";
import { useState } from "react";

export function ExplorerDeleteDialogView({
  paths,
  onClose,
  onConfirm,
}: {
  paths: string[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteLabel =
    paths.length === 1
      ? (paths[0].split("/").filter(Boolean).pop() ?? paths[0])
      : `${paths.length} items`;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Permanently</AlertDialogTitle>
          <AlertDialogDescription>
            Delete <strong className="font-semibold text-cream">{deleteLabel}</strong>? This cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-cream">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-charcoal-active text-cream-bright"
            disabled={working}
            onClick={(event) => {
              event.preventDefault();
              if (working) return;
              setWorking(true);
              setError(null);
              void onConfirm()
                .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
                .finally(() => setWorking(false));
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
