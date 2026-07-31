export interface NotesTopBarProps {
  query: string;
  contextPanelOpen: boolean;
  contextPanelAvailable?: boolean;
  onQueryChange: (query: string) => void;
  onNewNote: () => void;
  onToggleContextPanel: () => void;
}
