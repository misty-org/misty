import type { NoteGroupId } from "@/models/types/features/notes/types";

export interface NotesTopBarProps {
  query: string;
  activeGroup: NoteGroupId;
  syncing: boolean;
  lastSyncedAt?: string;
  contextPanelOpen: boolean;
  onQueryChange: (query: string) => void;
  onSelectGroup: (group: string) => void;
  onSync: () => void;
  onNewNote: () => void;
  onToggleContextPanel: () => void;
}
