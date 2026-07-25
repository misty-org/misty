import type { UnifiedNote } from "@/models/types/features/notes/types";

export interface NoteReadingPaneProps {
  note?: UnifiedNote;
  loading: boolean;
  editingNoteId?: string;
  onEditingNoteChange?: (noteId: string | undefined) => void;
  /** Undefined for read-only sources; presence enables the Edit affordance. */
  onSaveBody?: (noteId: string, body: string) => void;
  onToggleFavorite?: (noteId: string) => void;
  onNewNote: () => void;
}

export interface NoteConflictNoticeProps {
  note: UnifiedNote;
}
