import type { AppRequest } from "../../connected-apps/api";
import type {
  AgentNotebook,
  AgentSubagent,
  AiArtifact,
  AiProgressItem,
  ScreenRequest,
} from "../../runs/invocations/invocationTypes";
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
  source?: "goal_continuation" | "continuation";
  /** Misty sees this message and everything before it only as summarized notes. */
  compactedAfter?: boolean;
  /** The engine's last usage report during this reply (`usage.updated`). */
  usage?: MessageUsage;
  /** The model the engine says answered. */
  model?: string;
  /** How long the run took, set when it completes. */
  durationMs?: number;
  /** Folders the engine was refused during this reply, each offered to the person to allow. */
  folderGrants?: FolderGrant[];
  /** The person's rating of this reply, kept with the chat on this device. */
  rating?: "good" | "bad";
}

/** A folder an engine was refused (`permission.denied`), and what the person did about it. */
export interface FolderGrant {
  id: string;
  /** The path the engine wanted, as it named it. */
  path?: string;
  /** What the engine said. */
  message: string;
  toolCallId?: string;
  toolName?: string;
  /** The folder allowing it would cover, as native code worked it out. */
  dir?: string;
  status: "pending" | "granted" | "declined";
}

/** One usage report's token buckets; they don't overlap, and any may be missing. */
export interface MessageUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Tokens held in the context. */
  used?: number;
  /** The model's context window, when the engine said. */
  window?: number;
  /** Of the output, the tokens spent reasoning. */
  reasoning?: number;
  /** What the reply cost in US dollars, when the engine said. */
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
  /** The agent folder this conversation is filed in; absent means Recents. */
  folderId?: string;
  id: string;
  title: string;
  /** The Space it belongs to, for its whole life. */
  spaceId?: string;
  /** Whether that's the person's personal Space, which a window shows without knowing its id. */
  personalSpace?: boolean;
  createdAt: string;
  updatedAt: string;
  /** When the user last saw it on this device; runs newer than this are unread. */
  lastReadAt?: string;
  /** The person marked it unread; opening it clears this. */
  markedUnread?: boolean;
  /** When it was pinned to the top of the sidebar. */
  pinnedAt?: string;
  /** When it was archived, which keeps it out of the sidebar's lists. */
  archivedAt?: string;
  /** The device that keeps this chat; absent while it waits in the server's inbox. */
  keptOnDeviceId?: string;
  /** Running notes on turns too old to send, written by this device's model; opaque here. */
  historyNotes?: unknown;
  modelId?: string;
  /** The model picked for this conversation; empty follows the account's Thinking choice. */
  modelOverride?: string;
  reasoningEffort?: "" | "low" | "medium" | "high" | "xhigh";
  messages: GlobalAiMessage[];
  remote: boolean;
}
