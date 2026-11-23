import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  ListRow,
  ListRowSkeleton,
} from "@misty/ui";
import { disk, type CompareRow, type CompareState } from "@/features/files";
import { formatBytes, messageOf } from "../format";
import { nameOf } from "../model";
import { newOpId } from "../use_operations";

const stateText: Record<Exclude<CompareState, "same">, string> = {
  changed: "Different",
  "only-left": "Only in the first",
  "only-right": "Only in the second",
};

const folderText: Record<Exclude<CompareState, "same">, string> = {
  changed: "A folder that differs",
  "only-left": "A folder only in the first",
  "only-right": "A folder only in the second",
};

const differenceText = (row: CompareRow) => {
  const state = row.state as Exclude<CompareState, "same">;
  if (row.folder) return folderText[state];
  const left = row.leftSize === undefined ? "" : formatBytes(row.leftSize);
  const right = row.rightSize === undefined ? "" : formatBytes(row.rightSize);
  if (left && right) return `${stateText[state]}, ${left} in the first and ${right} in the second`;
  return left || right ? `${stateText[state]}, ${left || right}` : stateText[state];
};

export function CompareDialog({
  left,
  right,
  onClose,
}: {
  left: string;
  right: string;
  onClose(): void;
}) {
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    const opId = newOpId();
    setRows(null);
    setError("");
    void disk
      .compare(left, right, opId)
      .then(
        (next) => live && setRows(next),
        (cause) => live && setError(messageOf(cause, "The folders couldn't be compared.")),
      )
      .finally(() => {
        live = false;
      });
    return () => {
      if (live) void disk.cancel(opId).catch(() => undefined);
      live = false;
    };
  }, [left, right, attempt]);
  const differing = rows?.filter((row) => row.state !== "same") ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" layout="scroll" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{`Compare ${nameOf(left)} and ${nameOf(right)}`}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {error ? (
            <ErrorState
              inline
              title="The folders couldn't be compared"
              line={error}
              action={{
                label: "Try again",
                variant: "secondary",
                onClick: () => setAttempt((n) => n + 1),
              }}
            />
          ) : rows === null ? (
            <ListRowSkeleton label="Comparing folders" lines={2} />
          ) : differing.length === 0 ? (
            <EmptyState inline title="The folders are the same" />
          ) : (
            <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Differences">
              {differing.map((row) => (
                <li key={row.relative}>
                  <ListRow label={row.relative} description={differenceText(row)} />
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" size="lg" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
