import { Button } from "@/ui";
import { Tabs } from "@sinm/react-chrome-tabs";
import type { TabProperties } from "@sinm/react-chrome-tabs/dist/chrome-tabs";
import { Plus } from "lucide-react";
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useExplorerDropRegistry } from "@/features/explorer/drag/ExplorerDragContext";
import { createExplorerDropTargetSpec } from "@/features/explorer/drag/ExplorerDropTarget";

export interface ChromeTabStripTab {
  id: string;
  title: string;
  path: string;
  paneId: string;
}

export interface ChromeTabStripProps {
  tabs: ChromeTabStripTab[];
  activeTabId: string;
  actions?: ReactNode;
  canCloseTab?: (tab: ChromeTabStripTab) => boolean;
  onAddTab: () => void;
  onCloseTab: (tab: ChromeTabStripTab) => void;
  onReorderTab?: (tabId: string, fromIndex: number, toIndex: number) => void;
  onSelectTab: (tabId: string) => void;
}
