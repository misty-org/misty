import type { SearchResult } from "@/models/interfaces/services/misty-api";

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
}

export interface GlobalSearchResult extends GlobalSearchDocument {
  score: number;
}

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
  kind: GlobalSearchKind | "route";
  title: string;
  href?: string;
  source: "current" | GlobalSearchDocument["source"];
  spaceId?: string;
  spaceName?: string;
  /** Device paths are local-only and must never be serialized into AI requests. */
  localPath?: string;
  attached?: boolean;
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
  agentId?: string;
  agentName?: string;
  spaceId?: string;
  spaceName?: string;
  runId?: string;
  resultHref?: string;
  error?: string;
}

export interface GlobalAiMessage {
  id: string;
  role: "user" | "assistant";
  mode: Exclude<GlobalAiMode, "search">;
  content: string;
  createdAt: string;
  citations?: GlobalAiCitation[];
  action?: GlobalAiActionProposal;
}

export interface GlobalAiConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: GlobalAiMessage[];
  remote: boolean;
}
