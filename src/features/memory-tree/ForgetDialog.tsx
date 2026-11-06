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
  ErrorNotification,
  Skeleton,
} from "@/shared/ui";
import { treeApi } from "./api";
import { useMemoryTreeStore } from "./useMemoryTreeStore";

/** Counts what a node holds first, so the person confirms a number rather than a guess. */
export function ForgetDialog({
  nodeId,
  label,
  open,
  onOpenChange,
}: {
  nodeId: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setTotal(null);
    setError("");
    const { spaceId, range } = useMemoryTreeStore.getState();
    treeApi
      .forget(spaceId, nodeId, range, true)
      .then((result) => current && setTotal(result.would_forget ?? 0))
      .catch(() => current && setError("Memory couldn't count what's here. Try again."));
    return () => {
      current = false;
    };
  }, [open, nodeId]);

  const confirm = async () => {
    setBusy(true);
    try {
      await useMemoryTreeStore.getState().forget(nodeId);
      onOpenChange(false);
    } catch {
      setError("Memory couldn't forget that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Forget {label}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {total === null ? (
                <Skeleton className="h-4 w-56" />
              ) : total === 0 ? (
                "There's nothing to forget here."
              ) : (
                `This removes ${total.toLocaleString()} ${total === 1 ? "memory" : "memories"}.`
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorNotification message={error} onDismiss={() => setError("")} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !total}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            Forget
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
