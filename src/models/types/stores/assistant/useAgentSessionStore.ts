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
  agentServerContext,
} from "@/features/agents/pathPrivacy";
import { mistyDocumentsEnabled } from "@/features/agents/flags";
import {
  clearPendingAgentDelegations,
  hasPendingAgentDelegations,
  agentDelegationMessage,
  publicAgentDisplayName,
  publicAgentModel,
  resolvePendingAgentDelegation,
  trackPendingAgentDelegation,
  tryAgentSpaceDelegation,
} from "@/stores/assistant/useAgentDelegationStore";

import type {
  AiStatus,
  AiPlanReview,
  AiToolApproval,
  SendAiPromptRequest,
  AiSessionStore,
} from "@/models/interfaces/stores/assistant/useAgentSessionStore";

export type AiPanelMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "error" | "plan";
  text: string;
  planId?: string;
  toolRequestId?: string;
  hostedAiUsedRatio?: number;
  hostedAiResetAt?: string;
  citations?: AgentCitation[];
  contextSources?: AgentContextSource[];
  delegatedRunId?: string;
};

export type AgentContextSource = {
  id: string;
  kind: "library" | "note" | "task" | "chat" | "member";
  label: string;
  href: string;
};

export type AssistantScope = "files" | "cleanup" | "search";

export type AssistantRequestScope = AssistantScope | "ambiguous" | null;
