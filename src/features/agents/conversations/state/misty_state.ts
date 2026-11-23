import type { DisplayCapture } from "../../tutor/cursor/protocol";
import type { ThinkingMode } from "../../runs/jobs/thinking_mode";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "../../runs/invocations";
import type { AiArtifact, AiCaptureAttachment } from "../../runs/invocations/invocation_types";
import type { MistyContextTarget } from "../context/context";
import type { MistyHandoff } from "../ask/handoff";
import type {
  GlobalAiContextRef,
  GlobalAiConversation,
  MistyImageAttachment,
} from "./conversation_types";
export interface MistyState {
  thinkingMode?: ThinkingMode;
  thinkingModeExplicit?: boolean;
  selectedAgentId?: string;
  executionMode?: "user" | "agent";
  artifactPaneId?: string;
  artifactConversationId?: string;
  pendingArtifact?: AiArtifact;
  screenLabel?: string;
  selectedSpaceId?: string;
  draftSpaceId?: string;
  targets?: MistyContextTarget[];
  handoff?: MistyHandoff;
  invocationId?: string;
  invocationConversationId?: string;
  accountId: string;
  query: string;
  working: boolean;
  conversationsLoading: boolean;
  conversationsError: string | null;
  error: string | null;
  context: GlobalAiContextRef[];
  conversations: GlobalAiConversation[];
  activeConversationId: string;
  setAccount: (accountId: string) => void;
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
  setMessageLedger: (conversationId: string, messageId: string, content: string) => void;
  rewindConversation: (conversationId: string, messageId: string) => void;
  submit: () => Promise<void>;
  cancelResponse?: () => Promise<void>;
  steerResponse?: (text: string, conversationId?: string) => Promise<void>;
  submitAnswer: (
    prompt: string,
    attachments?: MistyImageAttachment[],
    selection?: AiSelectionSnapshot,
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
      permissionMode?: "ask" | "auto" | "bypass";
      displayCaptures?: DisplayCapture[];
      capture?: AiCaptureAttachment;
      continuation?: boolean;
      collaborationMode?: "teach" | "act";
      spaceId?: string;
      openScreen?: boolean;
    },
  ) => Promise<void>;
}
