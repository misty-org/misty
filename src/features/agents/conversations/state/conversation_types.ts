import type { AppRequest } from "../../connected-apps/api";
import type {
  AgentNotebook,
  AgentSubagent,
  AiArtifact,
  AiProgressItem,
  ScreenRequest,
} from "../../runs/invocations/invocation_types";
type GlobalAiCitationKind =
  | "space"
  | "note"
  | "message"
  | "conversation"
  | "library"
  | "folder"
  | "file"
  | "agent"
  | "action";

export interface GlobalAiContextRef {
  id: string;
  kind: string;
  title: string;
  href?: string;
  source: "current" | "local" | "server" | "device";
  spaceId?: string;
  spaceName?: string;
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
  progress?: AiProgressItem[];
  attachments?: MistyImageAttachment[];
  citations?: GlobalAiCitation[];
  appRequest?: AppRequest;
  screenRequest?: ScreenRequest;
  notebook?: AgentNotebook;
  subagents?: AgentSubagent[];
  source?: "goal_continuation" | "continuation";
  compactedAfter?: boolean;
  usage?: MessageUsage;
  model?: string;
  tutorHandoff?: { agentId: string; conversationId: string };
  tutorSeen?: string;
  durationMs?: number;
  folderGrants?: FolderGrant[];
  rating?: "good" | "bad";
  importedFrom?: string;
  reasoning?: string;
}

export interface FolderGrant {
  id: string;
  path?: string;
  message: string;
  toolCallId?: string;
  toolName?: string;
  dir?: string;
  status: "pending" | "granted" | "declined";
}

export interface MessageUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  used?: number;
  window?: number;
  reasoning?: number;
  costUsd?: number;
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
  folderId?: string;
  id: string;
  title: string;
  spaceId?: string;
  personalSpace?: boolean;
  createdAt: string;
  updatedAt: string;
  lastReadAt?: string;
  markedUnread?: boolean;
  pinnedAt?: string;
  archivedAt?: string;
  place?: "studio" | "tutor";
  keptOnDeviceId?: string;
  historyNotes?: unknown;
  modelId?: string;
  modelOverride?: string;
  reasoningEffort?: "" | "low" | "medium" | "high" | "xhigh";
  messages: GlobalAiMessage[];
  messageBeforeSeq?: number;
  hasOlderMessages?: boolean;
  remote: boolean;
}
