import type { DisplayCapture, MediaContext } from "@/features/agents";
import type { ThinkingMode } from "@/features/agents/thinkingMode";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "@/features/ai-surface";
import type { AiArtifact, AiCaptureAttachment } from "@/features/ai-surface/types";
import type { MistyContextTarget } from "./context";
import type { MistyHandoff } from "./handoff";
import type { BrowserAskRequest } from "./browserAskContext";
import type {
  GlobalAiContextRef,
  GlobalAiConversation,
  MistyImageAttachment,
  UnifiedMistyPanel,
} from "./types";
type MistySubmissionPresentation = "panel" | "workspace";
export interface MistyState {
  thinkingMode?: ThinkingMode;
  thinkingModeExplicit?: boolean;
  /** A model picked before the conversation exists; the first message carries it. */
  pendingModelOverride?: string;
  selectedAgentId?: string;
  /** Where the current task works; set per task, never chosen up front. */
  executionMode?: "user" | "agent";
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
  query: string;
  working: boolean;
  conversationsLoading: boolean;
  error: string | null;
  context: GlobalAiContextRef[];
  conversations: GlobalAiConversation[];
  activeConversationId: string;
  setAccount: (accountId: string) => void;
  openPanel: (context?: GlobalAiContextRef[]) => void;
  closePanel: () => void;
  setQuery: (query: string) => void;
  setContext: (context: GlobalAiContextRef[]) => void;
  removeContext: (id: string) => void;
  loadConversations: (
    reconnect?: boolean,
    expected?: { accountId: string; agentId: string; conversationId: string; invocationId: string },
  ) => Promise<void>;
  newConversation: (spaceId?: string, agentId?: string) => Promise<string>;
  selectConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  /** Drops a message and everything after it, so a prompt can be sent again from there. */
  /** Replaces an answer's text (its ledger changed). */
  setMessageLedger: (conversationId: string, messageId: string, content: string) => void;
  rewindConversation: (conversationId: string, messageId: string) => void;
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
      executionMode: "user" | "agent";
      turn?: number;
      interactionMode?: "team" | "auto";
      model?: string;
      idempotencyKey?: string;
      methodVersionId?: string;
      methodInputs?: Record<string, string | number | boolean>;
      skillVersionIds?: string[];
      displayCaptures?: DisplayCapture[];
      capture?: AiCaptureAttachment;
      /** Continues the conversation after a screen opened; shows no new user turn. */
      continuation?: boolean;
      /** Sends the turn as a lesson step (Teach mode) whatever the chat's saved mode. */
      collaborationMode?: "teach";
      /** What the video in front was saying (companion/mediaContext.ts). */
      mediaContext?: MediaContext;
      /** A scheduled run this computer claimed (roadmap C1). */
      schedule?: { id: string; claim: string };
      /** Opens a tab in this window for the task, at this page when given. */
      openScreen?: { url?: string; hint?: string; tabId?: string; place?: "current" | "new" };
    },
  ) => Promise<void>;
  submitAgentTask: (prompt: string, presentation?: MistySubmissionPresentation) => Promise<void>;
}
