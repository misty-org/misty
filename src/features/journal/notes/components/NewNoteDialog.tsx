import { NewNoteDialogView, type NewNoteDialogProps } from "./NewNoteDialogView";
export type { NewNoteDialogProps } from "./NewNoteDialogView";
export function NewNoteDialog(props: NewNoteDialogProps) {
  return <NewNoteDialogView {...props} />;
}
