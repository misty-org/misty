import { File, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { AgentSources } from "@/features/agents/AgentSources";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { safeTauriAssetUrl } from "@/platform/tauri";
import type { AiPanelMessage } from "@/models/types/stores/assistant/useAgentSessionStore";
import type {
  AiPlanReview,
  AiToolApproval,
} from "@/models/interfaces/stores/assistant/useAgentSessionStore";
import { cx } from "@/features/explorer/desktop/ExplorerDesktopShared";
import { assistantPanelStyles } from "@/features/explorer/desktop/ExplorerAssistantStyles";

export type AssistantPlanOperation = AiPlanReview["plan"]["operations"][number];
