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

const stateText: Record<Exclude<CompareState, "same">, string> = {
  changed: "Different",
  "only-left": "Only in the first",
  "only-right": "Only in the second",
};

const sizeText = (row: CompareRow) =>
  row.folder
    ? "Folder"
    : [row.leftSize, row.rightSize]
        .filter((size): size is number => size !== undefined)
        .map(formatBytes)
        .join(" · ");

/** Two folders side by side by content: what differs, and what only one of them has. */
export function CompareDialog({ left, right, onClose }: { left: string; right: string; onClose(): void }) {
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setRows(null);
    setError("");
    void disk.compare(left, right).then(
      (next) => live && setRows(next),
      (cause) => live && setError(messageOf(cause, "The folders couldn't be compared.")),
    );
    return () => {
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
              action={{ label: "Try again", variant: "secondary", onClick: () => setAttempt((n) => n + 1) }}
            />
          ) : rows === null ? (
            <ListRowSkeleton label="Comparing folders" lines={2} />
          ) : differing.length === 0 ? (
            <EmptyState inline title="The folders are the same" />
          ) : (
            <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Differences">
              {differing.map((row) => (
                <li key={row.relative}>
                  <ListRow
                    label={row.relative}
                    description={`${stateText[row.state as Exclude<CompareState, "same">]} · ${sizeText(row)}`}
                  />
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
