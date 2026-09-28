import type { NewNoteDialogProps } from "../model/interfaces/components/NotesIntegrationsDialog";
import { NewNoteDialogView } from "./NewNoteDialogView";
export type { NewNoteDialogProps } from "../model/interfaces/components/NotesIntegrationsDialog";
export function NewNoteDialog(props: NewNoteDialogProps) {
  return <NewNoteDialogView {...props} />;
}
