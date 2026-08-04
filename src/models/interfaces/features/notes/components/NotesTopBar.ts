export interface NotesTopBarProps {
  query: string;
  contextPanelOpen: boolean;
  contextPanelAvailable?: boolean;
  readOnly?: boolean;
  onQueryChange: (query: string) => void;
  onNewNote: () => void;
  onToggleContextPanel: () => void;
}
