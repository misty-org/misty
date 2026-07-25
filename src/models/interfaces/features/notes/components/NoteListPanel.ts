import type { UnifiedNote } from "@/models/types/features/notes/types";

export interface NoteListPanelProps {
  notes: UnifiedNote[];
  query: string;
  loading: boolean;
  spaceName: string;
  selectedNoteId?: string;
  connectorErrors: Record<string, string>;
  onSelectNote: (noteId: string) => void;
  onNewNote: () => void;
  onClearQuery: () => void;
}

export interface NoteListItemProps {
  note: UnifiedNote;
  selected: boolean;
  onSelect: () => void;
}
