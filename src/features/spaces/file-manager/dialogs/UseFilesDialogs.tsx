import { useCallback, useMemo, useState, type ReactNode } from "react";
import { RenameItemDialog, useConfirmDelete } from "@misty/ui";
import type { Conflict, Resolution } from "@/features/files";
import { BatchRenameDialog } from "./BatchRenameDialog";
import { CompareDialog } from "./CompareDialog";
import { ConflictDialog } from "./ConflictDialog";
import { DuplicatesDialog } from "./DuplicatesDialog";
import type { TransferWhere } from "../transfers";

type Run = <T>(
  label: string,
  work: (opId: string) => Promise<T>,
  where?: TransferWhere,
) => Promise<T>;

export type NameAsk = {
  title: string;
  initial: string;
  confirmLabel?: string;
  fieldLabel?: string;
  onConfirm(name: string): Promise<unknown>;
};

type Open =
  | ({ kind: "name"; key: number } & NameAsk)
  | {
      kind: "conflicts";
      conflicts: Conflict[];
      op: "copy" | "move";
      resolve(answers: Record<string, Resolution> | null): void;
    }
  | { kind: "batch-rename"; paths: string[]; done(created: string[]): void }
  | { kind: "compare"; left: string; right: string }
  | { kind: "duplicates"; dir: string };

export type FilesDialogs = {
  name(ask: NameAsk): void;
  conflicts(conflicts: Conflict[], op: "copy" | "move"): Promise<Record<string, Resolution> | null>;
  batchRename(paths: string[], done: (created: string[]) => void): void;
  compare(left: string, right: string): void;
  duplicates(dir: string): void;
  confirm: ReturnType<typeof useConfirmDelete>["confirm"];
};

export function useFilesDialogs({
  run,
  trash,
}: {
  run: Run;
  trash(paths: string[]): Promise<void>;
}): { ask: FilesDialogs; node: ReactNode } {
  const [open, setOpen] = useState<Open | null>(null);
  const { confirm, dialog } = useConfirmDelete();
  const close = useCallback(() => setOpen(null), []);

  const ask = useMemo(
    (): FilesDialogs => ({
      name: (named) => setOpen({ kind: "name", key: Date.now(), ...named }),
      conflicts: (conflicts, op) =>
        new Promise((resolve) => setOpen({ kind: "conflicts", conflicts, op, resolve })),
      batchRename: (paths, done) => setOpen({ kind: "batch-rename", paths, done }),
      compare: (left, right) => setOpen({ kind: "compare", left, right }),
      duplicates: (dir) => setOpen({ kind: "duplicates", dir }),
      confirm,
    }),
    [confirm],
  );

  let node: ReactNode = null;
  if (open?.kind === "name")
    node = (
      <RenameItemDialog
        key={open.key}
        title={open.title}
        initialName={open.initial}
        confirmLabel={open.confirmLabel}
        fieldLabel={open.fieldLabel}
        onConfirm={open.onConfirm}
        onClose={close}
      />
    );
  else if (open?.kind === "conflicts")
    node = (
      <ConflictDialog
        conflicts={open.conflicts}
        op={open.op}
        onDone={(answers) => {
          close();
          open.resolve(answers);
        }}
      />
    );
  else if (open?.kind === "batch-rename")
    node = (
      <BatchRenameDialog
        paths={open.paths}
        onClose={close}
        onDone={(created) => {
          close();
          open.done(created);
        }}
      />
    );
  else if (open?.kind === "compare")
    node = <CompareDialog left={open.left} right={open.right} onClose={close} />;
  else if (open?.kind === "duplicates")
    node = <DuplicatesDialog dir={open.dir} run={run} onTrash={trash} onClose={close} />;

  return {
    ask,
    node: (
      <>
        {node}
        {dialog}
      </>
    ),
  };
}
