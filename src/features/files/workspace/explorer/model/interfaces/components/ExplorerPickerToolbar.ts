export interface ExplorerPickerToolbarProps {
  path: string;
  query: string;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoParent: boolean;
  onBack: () => void;
  onForward: () => void;
  onParent: () => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onQueryChange: (query: string) => void;
}
