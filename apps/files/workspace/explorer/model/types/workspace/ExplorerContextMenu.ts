import type { ReactNode } from "react";

export type ContextMenuLeafItem = {
  id: string;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  onRun: () => void;
};

export type ContextMenuBranchItem = {
  id: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  items: ContextMenuLeafItem[];
};

export type ContextMenuEntry = ContextMenuLeafItem | ContextMenuBranchItem;
