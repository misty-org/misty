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
  selectedAgentId?: string;
  executionMode?: "user" | "agent" | "team";
  executionModeByAgent?: Record<string, "user" | "agent" | "team">;
  artifactPaneId?: string;
  pendingArtifact?: AiArtifact;
  screenLabel?: string;
  selectedSpaceId?: string;
  targets?: MistyContextTarget[];
  handoff?: MistyHandoff;
  invocationId?: string;
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
  loadConversations: () => Promise<void>;
  newConversation: (spaceId?: string) => Promise<string>;
  bindConversationSpace: (conversationId: string, spaceId: string) => Promise<void>;
  selectConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  submit: () => Promise<void>;
  cancelResponse?: () => Promise<void>;
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
      displayCaptures?: DisplayCapture[];
      capture?: AiCaptureAttachment;
    },
  ) => Promise<void>;
  submitAgentTask: (
    prompt: string,
    paneId?: string,
    presentation?: MistySubmissionPresentation,
  ) => Promise<void>;
  approveAgentTask: (proposalId: string) => Promise<void>;
  cancelAgentTask: (proposalId: string) => Promise<void>;
  confirmAction: (proposalId: string) => Promise<void>;
  rejectAction: (proposalId: string) => void;
}
