import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
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
  SectionHeading,
} from "@misty/ui";
import { disk, type DuplicateGroup } from "@/features/files";
import { countText, formatBytes, messageOf } from "../format";
import { nameOf, parentOf } from "../model";
import type { TransferWhere } from "../transfers";

type Run = <T>(
  label: string,
  work: (opId: string) => Promise<T>,
  where?: TransferWhere,
) => Promise<T>;

export function DuplicatesDialog({
  dir,
  run,
  onTrash,
  onClose,
}: {
  dir: string;
  run: Run;
  onTrash(paths: string[]): Promise<void>;
  onClose(): void;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setGroups(null);
    setError("");
    void run("Finding duplicates", (opId) => disk.duplicates(dir, opId), { from: dir }).then(
      (found) => live && setGroups(found),
      (cause) => live && setError(messageOf(cause, "Duplicates couldn't be found.")),
    );
    return () => {
      live = false;
    };
  }, [dir, run, attempt]);

  const toggle = (path: string, on: boolean) =>
    setPicked((now) => (on ? [...now, path] : now.filter((other) => other !== path)));
  const trash = async () => {
    setBusy(true);
    try {
      await onTrash(picked);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent size="lg" layout="scroll" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{`Duplicates in ${nameOf(dir)}`}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {error ? (
            <ErrorState
              inline
              title="Duplicates couldn't be found"
              line={error}
              action={{
                label: "Try again",
                variant: "secondary",
                onClick: () => setAttempt((n) => n + 1),
              }}
            />
          ) : groups === null ? (
            <ListRowSkeleton label="Finding duplicates" lines={2} />
          ) : groups.length === 0 ? (
            <EmptyState
              inline
              title="No duplicates"
              line="Every file in this folder is different."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <section key={group.hash} className="grid gap-1">
                  <SectionHeading
                    as="h3"
                    title={`${countText(group.paths.length, "copy", "copies")} of ${formatBytes(group.size)} each`}
                  />
                  <ul className="m-0 grid list-none gap-0.5 p-0">
                    {group.paths.map((path) => (
                      <li key={path}>
                        <ListRow
                          label={nameOf(path)}
                          description={parentOf(path)}
                          trailing={
                            <Checkbox
                              aria-label={`Move ${nameOf(path)} to the Trash`}
                              checked={picked.includes(path)}
                              onCheckedChange={(checked) => toggle(path, checked === true)}
                            />
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" size="lg" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={busy || picked.length === 0}
            onClick={() => void trash()}
          >
            {picked.length ? `Move ${countText(picked.length)} to Trash` : "Move to Trash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
