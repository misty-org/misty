import { memo, useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { MultiPanelClosedPane, MultiPanelTab } from "@/models/interfaces/workspace";
import { MultiPanelWorkspace } from "@/features/workspace";
import { createMultiPanelStore } from "@/features/workspace";
import type { MultiPanelStore } from "@/models/interfaces/workspace";
import { RemoteEditPanel } from "@/pages/Providers/components/RemoteEditPanel";
import { RemoteListPanel } from "@/pages/Providers/components/RemoteListPanel";
import { ProviderConnectionDialog } from "@/pages/Providers/components/ProviderConnectionDialog";
import { ProviderDisconnectDialog } from "@/pages/Providers/components/ProviderDisconnectDialog";
import type { ProviderRemote, ProviderWorkflow } from "@/models/interfaces/services/misty-api";
import {
  createProvidersWorkspaceState,
  isProviderWorkspaceStale,
  selectProviderWorkspaceDerived,
  useProvidersStore,
} from "@/stores/providers";

export interface ProvidersMultiPanelSnapshot {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes: MultiPanelClosedPane[];
  nextPaneIndex: number;
  nextTabIndex: number;
}
