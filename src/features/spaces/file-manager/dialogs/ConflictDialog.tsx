import { useId, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Text,
} from "@misty/ui";
import type { Conflict, Resolution } from "@/features/files";
import { formatBytes, formatDate } from "../format";
import { nameOf } from "../model";

export function ConflictDialog({
  conflicts,
  op,
  onDone,
}: {
  conflicts: Conflict[];
  op: "copy" | "move";
  onDone(answers: Record<string, Resolution> | null): void;
}) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Resolution>>({});
  const [all, setAll] = useState(false);
  const allId = useId();
  const conflict = conflicts[at];
  const left = conflicts.length - at - 1;

  const answer = (resolution: Resolution) => {
    const next = { ...answers };
    const answered = all ? conflicts.slice(at) : [conflict];
    for (const item of answered) next[item.source] = resolution;
    if (all || left === 0) return onDone(next);
    setAnswers(next);
    setAt(at + 1);
  };

  if (!conflict) return null;
  const name = nameOf(conflict.source);
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{`“${name}” is already here`}</DialogTitle>
          </DialogHeader>
          <Text tone="muted" wrap>
            {`The one in this folder is ${formatBytes(conflict.existing.size)}, changed ${formatDate(
              conflict.existing.modifiedMs,
            )}. Replacing it moves it to the Trash.`}
          </Text>
          {left > 0 ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={allId}
                checked={all}
                onCheckedChange={(checked) => setAll(checked === true)}
              />
              <Label htmlFor={allId}>{`Apply to all ${left + 1}`}</Label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="quiet" size="lg" onClick={() => onDone(null)}>
              {op === "copy" ? "Stop copying" : "Stop moving"}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => answer("skip")}>
              Skip
            </Button>
            <Button variant="secondary" size="lg" onClick={() => answer("keep-both")}>
              Keep both
            </Button>
            <Button variant="primary" size="lg" onClick={() => answer("replace")}>
              Replace
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
