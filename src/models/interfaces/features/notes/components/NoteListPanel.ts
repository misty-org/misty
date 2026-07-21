import type { NotesConnector } from "@/models/interfaces/features/notes/connectors";
import type { NoteGroupId, UnifiedNote } from "@/models/types/features/notes/types";

export interface NoteListPanelProps {
  notes: UnifiedNote[];
  activeGroup: NoteGroupId;
  query: string;
  loading: boolean;
  spaceName: string;
  selectedNoteId?: string;
  connectorErrors: Record<string, string>;
  notionConnector?: NotesConnector;
  onSelectNote: (noteId: string) => void;
  onNewNote: () => void;
  onConnectNotion: () => void;
  onClearQuery: () => void;
}

export interface NoteListItemProps {
  note: UnifiedNote;
  selected: boolean;
  onSelect: () => void;
}
