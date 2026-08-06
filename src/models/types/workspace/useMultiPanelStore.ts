import { create } from "zustand";
import type { SplitOrientation } from "@/features/workspace/useMultiPanelStore";
import type {
  MultiPanelClosedPane,
  MultiPanelLayout,
  MultiPanelPane,
  MultiPanelTab,
} from "@/models/interfaces/workspace";

import type { MultiPanelStoreOptions, MultiPanelStore } from "@/models/interfaces/workspace";

export type MultiPanelStoreHook = ReturnType<typeof createMultiPanelStore>;
import type { createMultiPanelStore } from "@/features/workspace";
