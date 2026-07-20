import { memo, useCallback, useEffect, useMemo } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { FileBrowser } from "@/features/explorer/components/FileBrowser";
import { useExplorerStore } from "@/stores/explorer";
import type { FileEntry } from "@/models/interfaces/services/misty-api";
import { groupItemsByOperation } from "@/features/explorer/drag/operations";
import type {
  ExplorerDragModifiers,
  ExplorerDragPayload,
} from "@/models/interfaces/features/explorer/drag/types";

export interface ExplorerPaneProps {
  paneId: string;
  path: string;
  isActive?: boolean;
  paneActions?: ReactNode;
}
