import type { SearchResult } from "@/native/contracts";

export type GlobalAiMode = "search" | "ask" | "action";

export type GlobalSearchKind =
  | "space"
  | "task"
  | "note"
  | "message"
  | "conversation"
  | "calendar"
  | "roadmap"
  | "drawing"
  | "activity"
  | "library"
  | "folder"
  | "file"
  | "agent"
  | "workflow"
  | "action";

export interface GlobalSearchDocument {
  id: string;
  accountId: string;
  kind: GlobalSearchKind;
  title: string;
  body: string;
  keywords: string[];
  href: string;
  spaceId?: string;
  spaceName?: string;
  updatedAt?: string;
  source: "local" | "server" | "device";
  fileResult?: SearchResult;
  canonicalId?: string;
  revision?: string | number;
  lexicalScore?: number;
  semanticScore?: number;
}

export interface GlobalSearchResult extends GlobalSearchDocument {
  score: number;
}

export type UnifiedMistyPanel = "closed" | "results" | "answer" | "agent";
export type GlobalSearchSourceFilter = "all" | "device" | "cloud";
export type GlobalSearchIntentFilter = "all" | "misty" | "agent";

export interface GlobalSearchFilters {
  kinds: GlobalSearchKind[];
  spaceId?: string;
  source: GlobalSearchSourceFilter;
  intent: GlobalSearchIntentFilter;
}

interface UnifiedMistyCandidateBase {
  id: string;
  title: string;
  description: string;
  score: number;
  ranking: string[];
}

export type UnifiedMistyCandidate =
  | (UnifiedMistyCandidateBase & {
      type: "object" | "navigation";
      result: GlobalSearchResult;
    })
  | (UnifiedMistyCandidateBase & {
      type: "command";
      commandId?: string;
      tabId?: string;
    })
  | (UnifiedMistyCandidateBase & {
      type: "answer" | "agent_task";
      prompt: string;
    });

export interface GlobalSearchContextItem {
  kind: GlobalSearchKind;
  title: string;
  snippet: string;
  href: string;
  space?: string;
  source: GlobalSearchDocument["source"];
}

export interface GlobalAiContextRef {
  id: string;
  kind: string;
  title: string;
  href?: string;
  source: "current" | GlobalSearchDocument["source"];
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
  kind: GlobalSearchKind;
}

export interface GlobalAiActionProposal {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  risk: "read" | "write" | "dangerous";
  state: "proposed" | "running" | "awaiting_approval" | "completed" | "failed" | "rejected";
  requiresConfirmation: boolean;
  agentName?: string;
  spaceId?: string;
  spaceName?: string;
  runId?: string;
  approvalId?: string;
  resultHref?: string;
  error?: string;
}

export interface GlobalAiMessage {
  id: string;
  role: "user" | "assistant";
  mode: Exclude<GlobalAiMode, "search">;
  content: string;
  createdAt: string;
  state?: "pending" | "streaming" | "completed" | "failed" | "canceled";
  retryable?: boolean;
  activity?: string;
  attachments?: MistyImageAttachment[];
  citations?: GlobalAiCitation[];
  action?: GlobalAiActionProposal;
}

export interface MistyImageAttachment {
  id: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  width: number;
  height: number;
  previewUrl: string;
  progress?: number;
  state: "preparing" | "uploading" | "ready" | "failed";
  error?: string;
}

export interface GlobalAiConversation {
  id: string;
  title: string;
  spaceId?: string;
  createdAt: string;
  updatedAt: string;
  modelId?: string;
  reasoningEffort?: "" | "low" | "medium" | "high";
  messages: GlobalAiMessage[];
  remote: boolean;
}
