import type { ReactNode } from "react";

export interface ExplorerPaneProps {
  paneId: string;
  path: string;
  isActive?: boolean;
  paneActions?: ReactNode;
}
