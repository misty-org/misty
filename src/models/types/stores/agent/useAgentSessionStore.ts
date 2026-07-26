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
import { selectAgentPreferences, useSettingsStore } from "@/stores/app";
import {
  cancelAgentSession,
  createAgentSession,
  deleteAgentSession,
  fetchAgentStatus,
  fetchAgentEvents,
  sendAgentMessage,
  submitToolResults,
} from "@/stores/agent/useAiServerStore";
import type { AiMode } from "@/models/types/stores/agent/useAiServerStore";
import type {
  AgentStatusResponse,
  FileOperationPlan,
  ToolManifest,
  ToolRequest,
  ToolResult,
} from "@/models/interfaces/stores/agent/useAiServerStore";
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
} from "@/stores/agent/useAgentDelegationStore";

import type {
  AiStatus,
  AiPlanReview,
  AiToolApproval,
  SendAiPromptRequest,
  AiSessionStore,
} from "@/models/interfaces/stores/agent/useAgentSessionStore";

export type AiPanelMessage = {
  id: string;
  role: "user" | "agent" | "tool" | "error" | "plan";
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

export type AgentScope = "files" | "cleanup" | "search";

export type AgentRequestScope = AgentScope | "ambiguous" | null;
