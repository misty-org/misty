import { Button } from "@/ui";
import { Columns2, GripVertical, PanelTopClose, Rows2 } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChromeTabStrip } from "@/features/workspace";
import type { MultiPanelTab } from "@/models/interfaces/workspace";
import { activeMultiPanelTab, maxMultiPanelPanes, useMultiPanelStore } from "@/features/workspace";
import type { MultiPanelStoreHook } from "@/models/types/workspace/useMultiPanelStore";

export interface MultiPanelWorkspaceProps {
  className?: string;
  store?: MultiPanelStoreHook;
  renderToolbar?: (paneId: string, path: string) => ReactNode;
  renderBottomBar?: (tab: MultiPanelTab) => ReactNode;
  renderTabActions?: () => ReactNode;
  showTabStrip?: boolean;
  showDefaultPaneControls?: boolean;
  renderContextHeader?: (tab: MultiPanelTab) => ReactNode;
  renderNavigationAside?: ReactNode;
  onNavigationAsideResizeStart?: (event: PointerEvent<HTMLDivElement>) => void;
  navigationAsideResizing?: boolean;
  renderAside?: ReactNode;
  onAsideResizeStart?: (event: PointerEvent<HTMLDivElement>) => void;
  asideResizing?: boolean;
  canCloseTab?: (tab: MultiPanelTab) => boolean;
  onDidCloseTab?: (tab: MultiPanelTab) => void;
  canClosePane?: (paneId: string, tab: MultiPanelTab) => boolean;
  onDidClosePane?: (paneId: string, tab: MultiPanelTab) => void;
  renderPane: (paneId: string, path: string) => ReactNode;
}
