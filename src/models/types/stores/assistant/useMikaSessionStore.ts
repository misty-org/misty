import { create } from "zustand";
import {
  explorerCreateItem,
  explorerListDirectory,
  explorerQueuePasteItems,
  explorerQueueRenameItem,
  searchQuery,
} from "@/stores/backend";
import { errorText } from "@/lib/format";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import { selectAssistantPreferences, useSettingsStore } from "@/stores/app";
import {
  cancelAgentSession,
  createAgentSession,
  deleteAgentSession,
  fetchAgentStatus,
  fetchAgentEvents,
  sendAgentMessage,
  submitToolResults,
} from "@/stores/assistant/useAiServerStore";
import type { AiMode } from "@/models/types/stores/assistant/useAiServerStore";
import type {
  AgentStatusResponse,
  FileOperationPlan,
  ToolManifest,
  ToolRequest,
  ToolResult,
} from "@/models/interfaces/stores/assistant/useAiServerStore";
import { agentsPrepareDocument, agentsRegisterFolderScope } from "@/stores/agents/useAgentsStore";
import type { AgentCitation } from "@/models/interfaces/features/agents/types";
import {
  deviceRelativePath,
  isSafeRelativePath,
  mikaServerContext,
} from "@/features/agents/pathPrivacy";
import { mistyDocumentsEnabled } from "@/features/agents/flags";
import {
  clearPendingMikaDelegations,
  hasPendingMikaDelegations,
  mikaDelegationMessage,
  publicMikaDisplayName,
  publicMikaModel,
  resolvePendingMikaDelegation,
  trackPendingMikaDelegation,
  tryMikaSpaceDelegation,
} from "@/stores/assistant/useMikaDelegationStore";

import type {
  AiStatus,
  AiPlanReview,
  AiToolApproval,
  SendAiPromptRequest,
  AiSessionStore,
} from "@/models/interfaces/stores/assistant/useMikaSessionStore";

export type AiPanelMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "error" | "plan";
  text: string;
  planId?: string;
  toolRequestId?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  citations?: AgentCitation[];
  delegatedRunId?: string;
};

export type AssistantScope = "files" | "cleanup" | "search";

export type AssistantRequestScope = AssistantScope | "ambiguous" | null;
