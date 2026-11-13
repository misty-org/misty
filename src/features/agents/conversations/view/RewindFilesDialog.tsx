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
} from "@/shared/ui";
import {
  chosenByDefault,
  fileKey,
  planFiles,
  type ChosenFile,
  type RewindFiles,
} from "../../checkpoints/turnFiles";

/** What the person decided about the files a rewind would put back. */
export type RewindChoice =
  { kind: "cancel" } | { kind: "keep" } | { kind: "restore"; files: ChosenFile[] };

/**
 * Asks before a rewind puts files back, since it changes the person's own files. The agent's
 * files are ticked; one the person changed since is listed unticked, so it is only overwritten
 * when they tick it.
 */
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
        <ul className="grid max-h-64 gap-1.5 overflow-y-auto text-sm" aria-label="Files">
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
                  <OverflowFadeText className="min-w-0 flex-1 text-xs" full>
                    {name}
                  </OverflowFadeText>
                  <Text bare tone="muted" className="shrink-0 text-xs">
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
          <Text bare as="p" tone="muted" className="text-sm">
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
