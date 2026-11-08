import { invoke } from "@/native/invoke";

/**
 * Memory on this computer. The account
 * is always the one signed in here, and the personal Space is the empty Space id.
 */

export interface DeviceMemoryEvent {
  id: string;
  space_id: string;
  kind: "page" | "voice" | "recording" | "note" | "screen";
  url?: string;
  site?: string;
  title: string;
  body?: string;
  same_as?: string;
  dwell_ms: number;
  occurred_at: string;
  app?: string;
  window_title?: string;
  session_id?: string;
}

export interface DeviceMemoryHit {
  branch: string;
  record_id: string;
  text: string;
  distance: number;
}

export interface DeviceMemoryFact {
  id: string;
  space_id?: string;
  kind: "fact" | "preference" | "instruction";
  content: string;
  reason?: string;
  source_conversation_id?: string;
  source_invocation_id?: string;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export interface DeviceMemoryStatus {
  waiting: number;
  cap: number;
  full: boolean;
  message?: string;
}

export interface MemoryChunkKey {
  space_id: string;
  branch: string;
  record_id: string;
  content_hash: string;
}

export type ForgetCountsResult = {
  forgotten?: number;
  would_forget?: number;
  counts: { moments: number; summaries: number; facts: number; workflows: number };
};

interface EventQuery {
  space_id: string;
  from?: string;
  to?: string;
  site?: string;
  kind?: string;
  ids?: string[];
  limit?: number;
}

interface PrefScope {
  space_id: string;
  agent_id: string;
  limit?: number;
}

interface PrefEdit {
  space_id: string;
  agent_id: string;
  id: string;
  content?: string;
}

export const deviceMemory = {
  record: (event: Record<string, unknown>) =>
    invoke<{ id: string; same_as: string }>("memory_record", { event }),
  events: (query: EventQuery) => invoke<DeviceMemoryEvent[]>("memory_events", { query }),
  search: (query: {
    space_id: string;
    branches: string[];
    vector: number[];
    model: string;
    limit?: number;
  }) => invoke<DeviceMemoryHit[]>("memory_search", { query }),
  forget: (request: {
    space_id: string;
    all?: boolean;
    site?: string;
    from?: string;
    to?: string;
    node_id?: string;
    dry_run?: boolean;
  }) => invoke<ForgetCountsResult>("memory_forget", { request }),
  tree: <Node>(query: { space_id: string; parent?: string; from?: string; to?: string }) =>
    invoke<Node[]>("memory_tree", { query }),
  addNode: (node: {
    space_id: string;
    branch: string;
    title?: string;
    text: string;
    kind?: string;
  }) => invoke<{ id: string; branch: string }>("memory_node_add", { node }),
  status: () => invoke<DeviceMemoryStatus>("memory_status"),
  exportZip: () => invoke<ArrayBuffer>("memory_export"),
  saveRecap: (recap: { space_id: string; date: string; markdown: string; outline?: unknown }) =>
    invoke<string>("memory_recap_save", { recap }),
  prefs: (scope: PrefScope) => invoke<DeviceMemoryFact[]>("memory_prefs_list", { scope }),
  context: (scope: PrefScope) => invoke<DeviceMemoryFact[]>("memory_context", { scope }),
  remember: (input: {
    space_id: string;
    agent_id: string;
    kind: string;
    content: string;
    reason?: string;
    source_conversation_id?: string;
    source_invocation_id?: string;
  }) => invoke<DeviceMemoryFact>("memory_pref_remember", { input }),
  updatePref: (edit: PrefEdit) => invoke<void>("memory_pref_update", { edit }),
  forgetPref: (edit: PrefEdit) => invoke<void>("memory_pref_forget", { edit }),
  claimChunks: (limit: number) =>
    invoke<(MemoryChunkKey & { text: string })[]>("memory_embed_claim", { limit }),
  completeChunks: (result: {
    model?: string;
    chunks?: (MemoryChunkKey & { vector: number[] })[];
    failed?: MemoryChunkKey[];
  }) => invoke<void>("memory_embed_complete", { result }),
};
