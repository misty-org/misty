import type { DisplayCapture } from "@/features/agents";
import type { ThinkingMode } from "@/features/agents/thinkingMode";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "@/features/ai-surface";
import type { AiArtifact, AiCaptureAttachment } from "@/features/ai-surface/types";
import type { MistyContextTarget } from "@/features/misty/context";
import type { MistyHandoff } from "@/features/misty/handoff";
import type { BrowserAskRequest } from "./browserAskContext";
import type {
  GlobalAiContextRef,
  GlobalAiConversation,
  GlobalAiMode,
  GlobalSearchFilters,
  GlobalSearchResult,
  MistyImageAttachment,
  UnifiedMistyPanel,
} from "./types";
export type MistySubmissionPresentation = "panel" | "workspace";
export interface GlobalSearchState {
  thinkingMode?: ThinkingMode;
  thinkingModeExplicit?: boolean;
  /** A model picked before the conversation exists; the first message carries it. */
  pendingModelOverride?: string;
  selectedAgentId?: string;
  /** Where the current task works; set per task, never chosen up front. */
  executionMode?: "user" | "agent" | "team";
  artifactPaneId?: string;
  artifactConversationId?: string;
  pendingArtifact?: AiArtifact;
  screenLabel?: string;
  selectedSpaceId?: string;
  targets?: MistyContextTarget[];
  handoff?: MistyHandoff;
  invocationId?: string;
  invocationConversationId?: string;
  browserRequest?: BrowserAskRequest;
  accountId: string;
  panel: UnifiedMistyPanel;
  mode: GlobalAiMode;
  query: string;
  results: GlobalSearchResult[];
  searching: boolean;
  enriched: boolean;
  working: boolean;
  conversationsLoading: boolean;
  error: string | null;
  requestId: number;
  context: GlobalAiContextRef[];
  conversations: GlobalAiConversation[];
  activeConversationId: string;
  filters: GlobalSearchFilters;
  selectedCandidateId: string;
  setAccount: (accountId: string) => void;
  activateLauncher: () => void;
  togglePanel: () => void;
  openPanel: (context?: GlobalAiContextRef[]) => void;
  closePanel: () => void;
  setMode: (mode: GlobalAiMode) => void;
  setQuery: (query: string) => void;
  setFilters: (filters: GlobalSearchFilters) => void;
  setSelectedCandidateId: (id: string) => void;
  setContext: (context: GlobalAiContextRef[]) => void;
  removeContext: (id: string) => void;
  clear: () => void;
  search: (query: string) => Promise<void>;
  visualSearch: (attachmentId: string, query?: string) => Promise<void>;
  loadConversations: (
    reconnect?: boolean,
    expected?: { accountId: string; agentId: string; conversationId: string; invocationId: string },
  ) => Promise<void>;
  newConversation: (spaceId?: string, agentId?: string) => Promise<string>;
  bindConversationSpace: (conversationId: string, spaceId: string) => Promise<void>;
  selectConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  submit: () => Promise<void>;
  cancelResponse?: () => Promise<void>;
  steerResponse?: (text: string, conversationId?: string) => Promise<void>;
  submitAnswer: (
    prompt: string,
    attachments?: MistyImageAttachment[],
    selection?: AiSelectionSnapshot,
    presentation?: MistySubmissionPresentation,
    deviceContexts?: AiInvocationDeviceContext[],
    origin?: {
      conversationId: string;
      context: GlobalAiContextRef[];
    },
    companion?: {
      executionMode: "user" | "team" | "agent";
      turn?: number;
      interactionMode?: "team" | "auto";
      model?: string;
      idempotencyKey?: string;
      methodVersionId?: string;
      methodInputs?: Record<string, string | number | boolean>;
      skillVersionIds?: string[];
      displayCaptures?: DisplayCapture[];
      /** Explain and point at `displayCaptures`, with no tools. */
      intent?: "teach";
      capture?: AiCaptureAttachment;
      /** Continues the conversation after a screen opened; shows no new user turn. */
      continuation?: boolean;
      /** Opens a tab in this window for the task, at this page when given. */
      openScreen?: { url?: string; hint?: string; tabId?: string; place?: "current" | "new" };
    },
  ) => Promise<void>;
  submitAgentTask: (
    prompt: string,
    paneId?: string,
    presentation?: MistySubmissionPresentation,
  ) => Promise<void>;
}
