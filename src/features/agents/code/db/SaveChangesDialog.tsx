import { useMemo, useState } from "react";
import {
  Button,
  CodeBlock,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
} from "@misty/ui";
import { errorText } from "./dbApi";
import { rowKey, useDbStore, type DbTab } from "./dbStore";
import { updateStatement } from "./sqlText";

/**
 * Asks before a table's changed rows are written, showing the UPDATE each row becomes. Each row
 * is saved in its own transaction that only commits when it changes exactly that row; a failure
 * stops there and says why, and the rows saved before it stay saved.
 */
export function SaveChangesDialog(props: { tab: DbTab; keyColumns: string[]; onClose(): void }) {
  const { tab, keyColumns } = props;
  const saveEdits = useDbStore((state) => state.saveEdits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = Object.keys(tab.edits).length;

  const statements = useMemo(() => {
    if (!tab.table || !tab.result) return "";
    const { table, result } = tab;
    return Object.entries(tab.edits)
      .map(([row, changes]) =>
        updateStatement(table, rowKey(result, Number(row), keyColumns), changes),
      )
      .join("\n\n");
  }, [tab, keyColumns]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await saveEdits(tab.id);
      props.onClose();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogContent size="lg" layout="scroll" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {rows === 1 ? "Save the change to 1 row?" : `Save changes to ${rows} rows?`}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>{statements ? <CodeBlock code={statements} copy={false} /> : null}</DialogBody>
        <FieldError message={error} />
        <DialogFooter>
          <Button variant="quiet" size="lg" disabled={busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" disabled={busy || !rows} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
