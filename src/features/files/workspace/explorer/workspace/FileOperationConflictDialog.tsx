import { operationQueueResolveConflict } from "@/native/transfers-tools";
import type { OperationQueueSnapshot } from "@/native/ipc";
import type { OperationConflictPolicy } from "@/native/ipc/primitives";
import { errorText } from "@/shared/lib/format";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
} from "@/shared/ui";
import { useState } from "react";
import { useOperationQueueStore } from "../store";

/** Name collisions belong to the file action, even without a history workspace. */
export function FileOperationConflictDialog() {
  const conflict = useOperationQueueStore((state) => state.snapshot?.conflictDialog);
  return conflict?.open ? <ConflictPrompt key={conflict.operationId} conflict={conflict} /> : null;
}

function ConflictPrompt({ conflict }: { conflict: OperationQueueSnapshot["conflictDialog"] }) {
  const [working, setWorking] = useState(false);
  const [applyToBatch, setApplyToBatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolve = async (policy: OperationConflictPolicy) => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const snapshot = await operationQueueResolveConflict(
        conflict.operationId,
        policy,
        applyToBatch,
      );
      useOperationQueueStore.setState({ snapshot });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setWorking(false);
    }
  };
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{conflict.title || "A file already exists"}</AlertDialogTitle>
          <AlertDialogDescription>
            Choose how to handle the file at the destination.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid gap-2 break-all text-sm">
          <div>
            <dt className="text-cream-muted">Source</dt>
            <dd>{conflict.sourceLabel}</dd>
          </div>
          <div>
            <dt className="text-cream-muted">Destination</dt>
            <dd>{conflict.targetLabel}</dd>
          </div>
        </dl>
        {conflict.batchId ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={applyToBatch}
              onCheckedChange={(checked) => setApplyToBatch(checked === true)}
              disabled={working}
            />
            Apply to remaining files
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-cream">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button variant="ghost" disabled={working} onClick={() => void resolve("skip")}>
            Skip
          </Button>
          {conflict.supportsKeepBoth ? (
            <Button
              variant="secondary"
              disabled={working}
              onClick={() => void resolve("keep_both")}
            >
              Keep both
            </Button>
          ) : null}
          {conflict.supportsReplace ? (
            <Button disabled={working} onClick={() => void resolve("replace")}>
              Replace
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
