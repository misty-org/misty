import { ArrowUp, ChevronDown, Info, Mic, Plus, ShieldAlert, Sparkles, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Textarea } from "@/ui";
import {
  hideRuntimeAssetOnError,
  revealRuntimeAssetOnLoad,
  runtimeAssetSource,
} from "@/platform/runtimeAsset";
import { useMultiPanelStore } from "@/features/workspace";
import { useAppStore } from "@/stores/app";
import { useExplorerStore } from "@/stores/explorer";
import { useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";
import type { AiMode } from "@/models/types/stores/assistant/useAiServerStore";
import { AssistantMessage } from "@/features/explorer/desktop/ExplorerAssistantMessage";
import {
  MikaContextContent,
  MikaEmptyState,
} from "@/features/explorer/desktop/ExplorerAssistantContext";
import {
  assistantPlaceholder,
  buildMikaPrompt,
  randomInteger,
  randomMikaPeek,
  selectedPathsAcrossPanes,
} from "@/features/explorer/desktop/ExplorerAssistantShared";
import { assistantPanelStyles } from "@/features/explorer/desktop/ExplorerAssistantStyles";
import { cx } from "@/features/explorer/desktop/ExplorerDesktopShared";

export interface ExplorerMikaPanelProps {
  surface?: "explorer" | "bot" | "bot-window" | "bot-chat-window";
  onHeaderDragStart?: () => void;
  onClose?: () => void;
  workingDirectory?: string;
  selectedPaths?: string[];
}
