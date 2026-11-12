import type { DisplayCapture } from "../../tutor/cursor/protocol";
import type { MediaContext } from "../../tutor/cursor/mediaContext";
import type { ThinkingMode } from "../../runs/jobs/thinkingMode";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "../../runs/invocations";
import type { AiArtifact, AiCaptureAttachment } from "../../runs/invocations/invocationTypes";
import type { MistyContextTarget } from "../context/context";
import type { MistyHandoff } from "../ask/handoff";
import type {
  GlobalAiContextRef,
  GlobalAiConversation,
  MistyImageAttachment,
  UnifiedMistyPanel,
} from "./conversationTypes";
type MistySubmissionPresentation = "panel" | "workspace";
export interface MistyState {
  thinkingMode?: ThinkingMode;
  thinkingModeExplicit?: boolean;
  selectedAgentId?: string;
  /** Where the current task works; set per task, never chosen up front. */
  executionMode?: "user" | "agent";
  artifactPaneId?: string;
  artifactConversationId?: string;
  pendingArtifact?: AiArtifact;
  screenLabel?: string;
  selectedSpaceId?: string;
  /** The Space picked for a new chat before its first message; unset, it is the window's. */
  draftSpaceId?: string;
  targets?: MistyContextTarget[];
  handoff?: MistyHandoff;
  invocationId?: string;
  invocationConversationId?: string;
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
      idempotencyKey?: string;
      /** Ask or Auto for this turn, whatever the chat's saved choice. */
      permissionMode?: "ask" | "auto" | "bypass";
      displayCaptures?: DisplayCapture[];
      capture?: AiCaptureAttachment;
      /** Continues the conversation after a screen opened; shows no new user turn. */
      continuation?: boolean;
      /** Sends the turn as a lesson step (Teach mode) or in Act, whatever the chat's saved mode. */
      collaborationMode?: "teach" | "act";
      /** What the video in front was saying (companion/mediaContext.ts). */
      mediaContext?: MediaContext;
      /** The Space the turn runs in; absent is the window's. */
      spaceId?: string;
      /** Opens a tab in this window for the task, at this page when given. */
      openScreen?: { url?: string; hint?: string; tabId?: string; place?: "current" | "new" };
    },
  ) => Promise<void>;
  submitAgentTask: (prompt: string, presentation?: MistySubmissionPresentation) => Promise<void>;
}
