import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "@/features/ai-surface";
import type {
  GlobalAiContextRef,
  GlobalAiConversation,
  GlobalAiMode,
  GlobalSearchFilters,
  GlobalSearchResult,
  UnifiedMistyPanel,
  MistyImageAttachment,
} from "./types";

export type MistySubmissionPresentation = "panel" | "workspace";

export interface GlobalSearchState {
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
  submitAnswer: (
    prompt: string,
    attachments?: MistyImageAttachment[],
    selection?: AiSelectionSnapshot,
    presentation?: MistySubmissionPresentation,
    deviceContexts?: AiInvocationDeviceContext[],
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
