import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  OverflowFadeText,
  Text,
} from "@misty/ui";
import {
  chosenByDefault,
  fileKey,
  planFiles,
  type ChosenFile,
  type RewindFiles,
} from "../../checkpoints/turn_files";

export type RewindChoice =
  { kind: "cancel" } | { kind: "keep" } | { kind: "restore"; files: ChosenFile[] };

export function RewindFilesDialog({
  plan,
  onChoose,
}: {
  plan: RewindFiles | null;
  onChoose: (choice: RewindChoice) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (plan) setChosen(new Set(chosenByDefault(plan).map(fileKey)));
  }, [plan]);
  const files = plan ? planFiles(plan) : [];
  const several = plan ? plan.folders.length > 1 : false;
  const toggle = (key: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  return (
    <AlertDialog
      open={Boolean(plan)}
      onOpenChange={(open) => !open && onChoose({ kind: "cancel" })}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Put back the files these turns changed?</AlertDialogTitle>
        </AlertDialogHeader>
        <ul className="grid max-h-64 gap-1.5 overflow-y-auto text-control" aria-label="Files">
          {files.map((file) => {
            const key = fileKey(file);
            const name = several ? `${file.folder}/${file.path}` : file.path;
            return (
              <li key={key}>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={chosen.has(key)}
                    onCheckedChange={(state) => toggle(key, state === true)}
                  />
                  <OverflowFadeText className="min-w-0 flex-1 text-meta" full>
                    {name}
                  </OverflowFadeText>
                  <Text size="meta" bare tone="muted" className="shrink-0">
                    {file.changedByYou
                      ? "Changed since"
                      : file.change === "remove"
                        ? "Remove"
                        : "Restore"}
                  </Text>
                </label>
              </li>
            );
          })}
        </ul>
        {plan?.incomplete ? (
          <Text size="control" bare as="p" tone="muted">
            Some of these turns weren&apos;t saved, so their changes stay.
          </Text>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button onClick={() => onChoose({ kind: "keep" })}>Keep files</Button>
          <AlertDialogAction
            disabled={!chosen.size}
            onClick={() =>
              onChoose({
                kind: "restore",
                files: files
                  .filter((file) => chosen.has(fileKey(file)))
                  .map(({ folder, path }) => ({ folder, path })),
              })
            }
          >
            Put files back
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
