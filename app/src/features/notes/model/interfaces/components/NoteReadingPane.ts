import type { NoteBodyFormat, UnifiedNote } from "../../types/types";

export interface NoteContentDraft {
  body: string;
  bodyFormat: NoteBodyFormat;
  bodyMarkdown?: string;
}

export interface NoteReadingPaneProps {
  note?: UnifiedNote;
  hasNotes?: boolean;
  accountId?: string;
  loading: boolean;
  editingNoteId?: string;
  referenceOnly?: boolean;
  onEditingNoteChange?: (noteId: string | undefined) => void;
  /** Undefined for read-only sources; presence enables the Edit affordance. */
  onSaveBody?: (noteId: string, body: string) => void;
  onSaveContent?: (noteId: string, content: NoteContentDraft) => void;
  onDelete?: (noteId: string) => Promise<void>;
  onNewNote: () => void;
}

export interface NoteConflictNoticeProps {
  note: UnifiedNote;
}
