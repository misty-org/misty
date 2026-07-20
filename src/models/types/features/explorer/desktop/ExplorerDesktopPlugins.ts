import { Input } from "@/ui";
import { Button } from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";
import {
  ArrowLeft,
  ArrowRightLeft,
  ExternalLink,
  Puzzle,
  RefreshCcw,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLocation, useNavigate } from "react-router-dom";
import {
  extensionCommandRun,
  openTerminalAtPath,
  pluginCommandRun,
  pluginPanelRender,
} from "@/stores/backend";
import type {
  PluginCommandEntry,
  PluginPanelElement,
  PluginPanelEntry,
  PluginPanelRenderResult,
  TransferRecord,
} from "@/models/interfaces/services/misty-api";
import { useMultiPanelStore } from "@/features/workspace";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { errorText } from "@/lib/format";
import { hasTauriInternals } from "@/platform/tauri";
import { selectedPathsForPane, useExplorerStore } from "@/stores/explorer";
import { useTransfersStore } from "@/stores/transfers";
import { cx } from "@/features/explorer/desktop/ExplorerDesktopShared";
import {
  explorerTrayStyles,
  extensionsPanelStyles,
  pluginTabHostStyles,
  pluginTabMenuStyles,
} from "@/features/explorer/desktop/ExplorerDesktopPluginStyles";

export type PluginMenuItem = {
  pluginId: string;
  pluginName: string;
  panels: PluginPanelEntry[];
  commands: PluginCommandEntry[];
  usable: boolean;
  primaryArea: string;
  kind: "panel" | "commands";
};

export type PluginTabState = {
  kind: "panel" | "commands";
  pluginId: string;
  panelId: string;
  selectedPath: string;
};
