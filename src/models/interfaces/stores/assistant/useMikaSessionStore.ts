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
  AiPanelMessage,
  AssistantScope,
  AssistantRequestScope,
  MikaContextSource,
} from "@/models/types/stores/assistant/useMikaSessionStore";

export interface AiStatus {
  configured: boolean;
  spaceScopedSessions: boolean;
  model: string;
  modelName: string;
  running: boolean;
  sessionId: string | null;
  error: string | null;
}

export interface AiPlanReview {
  id: string;
  plan: FileOperationPlan;
  applied: boolean;
  applying: boolean;
  appliedSummary: string | null;
  blockedReasons: string[];
  scope: AssistantScope | null;
}

export interface AiToolApproval {
  id: string;
  request: ToolRequest;
  running: boolean;
  completed: boolean;
  error: string | null;
  scope: AssistantScope | null;
}

export interface SendAiPromptRequest {
  displayPrompt: string;
  prompt: string;
  cwd: string | null;
  selectedPaths?: string[];
  contextSources?: MikaContextSource[];
}

export interface AiConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface AiSessionStore {
  status: AiStatus | null;
  mode: AiMode;
  messages: AiPanelMessage[];
  plans: AiPlanReview[];
  toolApprovals: AiToolApproval[];
  error: string | null;
  conversations: AiConversationSummary[];
  activeConversationId: string;
  conversationScopeKey: string;
  refreshStatus: () => Promise<void>;
  setMode: (mode: AiMode) => void;
  sendPrompt: (request: SendAiPromptRequest) => Promise<void>;
  approveToolRequest: (requestId: string) => Promise<void>;
  approvePlan: (planId: string) => Promise<void>;
  abortPrompt: () => Promise<void>;
  clearConversation: () => void;
  activateConversationScope: (scopeKey: string) => Promise<void>;
  startNewConversation: () => Promise<void>;
  /** Merges the account's server-side sessions into the local list. Safe to call repeatedly. */
  hydrateConversations: () => Promise<void>;
  switchConversation: (id: string) => Promise<void>;
  deleteConversationSession: (id: string) => Promise<void>;
}
