import type { AppRequest } from "@/features/agents";
import type {
  AgentNotebook,
  AgentSubagent,
  AiArtifact,
  AiProgressItem,
  ScreenRequest,
} from "@/features/ai-surface/types";
type GlobalAiCitationKind =
  | "space"
  | "note"
  | "message"
  | "conversation"
  | "calendar"
  | "drawing"
  | "library"
  | "folder"
  | "file"
  | "agent"
  | "action";

export type UnifiedMistyPanel = "closed" | "answer" | "agent";

export interface GlobalAiContextRef {
  id: string;
  kind: string;
  title: string;
  href?: string;
  source: "current" | "local" | "server" | "device";
  spaceId?: string;
  spaceName?: string;
  /** Device paths are local-only and must never be serialized into AI requests. */
  localPath?: string;
  attached?: boolean;
  privacy?: "shared" | "private" | "device" | "provider";
  revision?: string | number;
  opaqueScopeId?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface GlobalAiCitation {
  id: string;
  title: string;
  href: string;
  kind: GlobalAiCitationKind;
}

export interface GlobalAiMessage {
  artifact?: AiArtifact;
  invocationId?: string;
  id: string;
  role: "user" | "assistant";
  mode: "ask";
  content: string;
  createdAt: string;
  state?: "pending" | "streaming" | "completed" | "failed" | "canceled";
  retryable?: boolean;
  activity?: string;
  /** How this reply got its answer so far: notes and tool runs, in order. */
  progress?: AiProgressItem[];
  attachments?: MistyImageAttachment[];
  citations?: GlobalAiCitation[];
  /** Something the agent needs from the user: connect an app or approve an action. */
  appRequest?: AppRequest;
  /** A screen the agent asked for; Misty continues once it opens. */
  screenRequest?: ScreenRequest;
  /** The run's notebook: its plan and findings so far. */
  notebook?: AgentNotebook;
  /** Sub-agents the run started, with their progress. */
  subagents?: AgentSubagent[];
  /** Set on turns Misty started itself rather than the person typing them. */
  source?: "scheduled_task" | "goal_continuation" | "continuation" | "inbound_task";
  /** Misty sees this message and everything before it only as summarized notes. */
  compactedAfter?: boolean;
}

export interface MistyImageAttachment {
  id: string;
  name: string;
  mimeType:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "application/pdf"
    | "text/plain"
    | "text/markdown"
    | "text/csv"
    | "application/json"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  byteSize: number;
  width: number;
  height: number;
  previewUrl: string;
  progress?: number;
  state: "preparing" | "uploading" | "ready" | "failed";
  error?: string;
}

export interface GlobalAiConversation {
  agentId?: string;
  /** The agent folder this conversation is filed in; absent means Recents. */
  folderId?: string;
  id: string;
  title: string;
  spaceId?: string;
  createdAt: string;
  updatedAt: string;
  /** When the user last saw it on this device; runs newer than this are unread. */
  lastReadAt?: string;
  /** The device that keeps this chat; absent while it waits in the server's inbox. */
  keptOnDeviceId?: string;
  modelId?: string;
  /** The model picked for this conversation; empty follows the account's Thinking choice. */
  modelOverride?: string;
  reasoningEffort?: "" | "low" | "medium" | "high" | "xhigh";
  messages: GlobalAiMessage[];
  remote: boolean;
}
