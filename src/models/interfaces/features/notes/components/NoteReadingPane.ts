import type { UnifiedNote } from "@/models/types/features/notes/types";

export interface NoteReadingPaneProps {
  note?: UnifiedNote;
  loading: boolean;
  /** Undefined for read-only sources; presence enables the Edit affordance. */
  onSaveBody?: (noteId: string, body: string) => void;
  onOpenInSource: (noteId: string) => void;
  onToggleFavorite?: (noteId: string) => void;
  onNewNote: () => void;
  /**
   * Publishes this Misty note out to Notion. Undefined when no connected source
   * accepts writes, so the action never appears just to fail.
   */
  onPublishToNotion?: (noteId: string) => void;
  publishing?: boolean;
}

export interface NoteConflictNoticeProps {
  note: UnifiedNote;
  onOpenInSource: () => void;
}
