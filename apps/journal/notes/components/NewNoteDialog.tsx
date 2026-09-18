import { useSurfacePresentation } from "@/shared/mobile";
import { NewNoteDialogView } from "./NewNoteDialogView";
import type { NewNoteDialogProps } from "../model/interfaces/components/NotesIntegrationsDialog";
export type { NewNoteDialogProps } from "../model/interfaces/components/NotesIntegrationsDialog";
export function NewNoteDialog(props: NewNoteDialogProps) {
  return <NewNoteDialogView {...props} mobile={useSurfacePresentation() !== "desktop"} />;
}
