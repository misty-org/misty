export interface NotesTopBarProps {
  query: string;
  contextPanelOpen: boolean;
  onQueryChange: (query: string) => void;
  onNewNote: () => void;
  onToggleContextPanel: () => void;
}
