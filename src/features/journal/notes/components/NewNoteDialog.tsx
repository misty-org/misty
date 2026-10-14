import type { NewNoteDialogProps } from "../model/NotesIntegrationsDialog";
import { NewNoteDialogView } from "./NewNoteDialogView";
export type { NewNoteDialogProps } from "../model/NotesIntegrationsDialog";
export function NewNoteDialog(props: NewNoteDialogProps) {
  return <NewNoteDialogView {...props} />;
}
