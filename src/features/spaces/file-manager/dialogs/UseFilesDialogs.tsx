import { useEffect, useMemo, useRef, useState } from "react";
import { RenameItemDialog, useConfirmDelete } from "@misty/ui";
import type { Conflict, Resolution } from "@/features/files";
import { BatchRenameDialog } from "./BatchRenameDialog";
import { CompareDialog } from "./CompareDialog";
import { ConflictDialog } from "./ConflictDialog";
import { DuplicatesDialog } from "./DuplicatesDialog";

export type NameAsk = {
  title: string;
  initial: string;
  confirmLabel?: string;
  fieldLabel?: string;
  onConfirm(name: string): Promise<unknown>;
};

type Answers = Record<string, Resolution> | null;

type Open =
  | ({ kind: "name"; key: number } & NameAsk)
  | { kind: "conflicts"; conflicts: Conflict[]; op: "copy" | "move" }
  | { kind: "batch-rename"; paths: string[]; done(created: string[]): void }
  | { kind: "compare"; left: string; right: string }
  | { kind: "duplicates"; dir: string };

export type FilesDialogs = {
  name(ask: NameAsk): void;
  conflicts(conflicts: Conflict[], op: "copy" | "move"): Promise<Answers>;
  batchRename(paths: string[], done: (created: string[]) => void): void;
  compare(left: string, right: string): void;
  duplicates(dir: string): void;
  confirm: ReturnType<typeof useConfirmDelete>["confirm"];
};

export function FilesDialogsHost({
  onReady,
  trash,
}: {
  onReady(dialogs: FilesDialogs | null): void;
  trash(paths: string[]): Promise<void>;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const { confirm, dialog } = useConfirmDelete();
  const answer = useRef<((answers: Answers) => void) | null>(null);
  const close = () => setOpen(null);

  const ask = useMemo((): FilesDialogs => {
    const show = (next: Open) => {
      answer.current?.(null);
      answer.current = null;
      setOpen(next);
    };
    return {
      name: (named) => show({ kind: "name", key: Date.now(), ...named }),
      conflicts: (conflicts, op) =>
        new Promise((resolve) => {
          show({ kind: "conflicts", conflicts, op });
          answer.current = resolve;
        }),
      batchRename: (paths, done) => show({ kind: "batch-rename", paths, done }),
      compare: (left, right) => show({ kind: "compare", left, right }),
      duplicates: (dir) => show({ kind: "duplicates", dir }),
      confirm,
    };
  }, [confirm]);

  useEffect(() => {
    onReady(ask);
    return () => onReady(null);
  }, [ask, onReady]);

  useEffect(
    () => () => {
      answer.current?.(null);
      answer.current = null;
    },
    [],
  );

  let node = null;
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
          const resolve = answer.current;
          answer.current = null;
          resolve?.(answers);
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
    node = <DuplicatesDialog dir={open.dir} onTrash={trash} onClose={close} />;

  return (
    <>
      {node}
      {dialog}
    </>
  );
}
