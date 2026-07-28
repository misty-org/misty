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
import type { AiPanelMessage } from "@/models/types/stores/agent/useAgentSessionStore";
import type {
  AiPlanReview,
  AiToolApproval,
} from "@/models/interfaces/stores/agent/useAgentSessionStore";
import { cx } from "@/features/explorer/desktop/ExplorerDesktopShared";
import { agentPanelStyles } from "@/features/explorer/desktop/ExplorerAgentStyles";

export type AgentPlanOperation = AiPlanReview["plan"]["operations"][number];
