import type { AiConversationSummary } from "@/models/interfaces/stores/agent/useAgentSessionStore";
import type { AiPanelMessage } from "@/models/types/stores/agent/useAgentSessionStore";
import type { AgentSessionSummary } from "@/models/interfaces/stores/agent/useAiServerStore";
import { errorText } from "@/lib/format";
import { fetchAgentTranscript, listAgentSessions } from "@/stores/agent/useAiServerStore";

/**
 * Cross-device session sync for agents. Sessions live on the account, so a device
 * that has never seen one still lists it and can open its transcript. The store
 * owns conversation state; this module only talks to the server and hands back
 * plain data.
 */

/** The store's per-conversation record, narrowed to what syncing touches. */
export interface SyncableConversation {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  messages: AiPanelMessage[];
  transcriptLoaded: boolean;
  /** Model this chat is pinned to, if it overrides the agent/base default. */
  modelId?: string;
  runtime: { sessionId: string | null };
}

export interface AgentSyncDeps<T extends SyncableConversation> {
  snapshots: Map<string, T>;
  /** Builds an empty conversation record in the store's own shape. */
  createSnapshot: (id: string, updatedAt: number) => T;
  messageId: (prefix: string) => string;
  debug: (level: "info" | "warn" | "error", message: string, detail?: string) => void;
}

/**
 * Merges the account's server sessions into the local snapshot map and returns
 * the summaries that were newly added. Sessions already represented locally are
 * left alone, so in-flight local state is never clobbered.
 */
export async function hydrateServerSessions<T extends SyncableConversation>(
  deps: AgentSyncDeps<T>,
  belongsToScope?: (session: AgentSessionSummary) => boolean,
): Promise<AiConversationSummary[]> {
  let sessions;
  try {
    ({ sessions } = await listAgentSessions());
  } catch (error) {
    // Offline or signed out: the local list stays authoritative.
    deps.debug("warn", "Agent sessions could not be listed.", errorText(error));
    return [];
  }
  const knownSessionIds = new Set<string>();
  for (const snapshot of deps.snapshots.values()) {
    if (snapshot.runtime.sessionId) knownSessionIds.add(snapshot.runtime.sessionId);
  }
  const added: AiConversationSummary[] = [];
  for (const session of sessions) {
    if (knownSessionIds.has(session.id)) continue;
    if (belongsToScope && !belongsToScope(session)) continue;
    const updatedAt = Date.parse(session.updated_at) || Date.now();
    const createdAt = Date.parse(session.created_at) || updatedAt;
    // The server id doubles as the local conversation id for hydrated sessions,
    // which keeps rename and delete addressing the same row.
    const stored = deps.createSnapshot(session.id, updatedAt);
    stored.title = session.title || "New chat";
    stored.createdAt = createdAt;
    stored.transcriptLoaded = false;
    stored.modelId = session.model_id || undefined;
    stored.runtime.sessionId = session.id;
    deps.snapshots.set(session.id, stored);
    added.push({ id: session.id, title: stored.title, updatedAt, createdAt });
  }
  return added;
}

/**
 * Fetches a hydrated session's messages. The event stream is deliberately not
 * replayed for this: events carry tool requests, and replaying them would run
 * the tools a second time. The server's transcript is plain messages.
 */
export async function fetchConversationTranscript<T extends SyncableConversation>(
  sessionId: string,
  deps: AgentSyncDeps<T>,
): Promise<AiPanelMessage[] | null> {
  try {
    const transcript = await fetchAgentTranscript(sessionId);
    return transcript.messages
      .filter(
        (message) =>
          message.role === "user" ||
          message.role === "agent" ||
          // Pre-rename transcripts, and a server that has not been redeployed
          // yet, still label model turns "assistant".
          message.role === "assistant",
      )
      .map((message) => {
        const role: AiPanelMessage["role"] = message.role === "user" ? "user" : "agent";
        return {
          id: deps.messageId(role),
          role,
          text: message.content,
        };
      });
  } catch (error) {
    deps.debug("warn", "Agent transcript could not be loaded.", errorText(error));
    return null;
  }
}

/**
 * Loads a hydrated session's messages into the store, unless the person switched
 * away while the request was in flight.
 */
export async function loadConversationTranscript<T extends SyncableConversation>(
  conversationId: string,
  sessionId: string,
  deps: AgentSyncDeps<T>,
  setMessages: (messages: AiPanelMessage[]) => void,
  activeConversationId: () => string,
): Promise<void> {
  const messages = await fetchConversationTranscript(sessionId, deps);
  if (!messages) return;
  const snapshot = deps.snapshots.get(conversationId);
  if (snapshot) {
    deps.snapshots.set(conversationId, { ...snapshot, messages, transcriptLoaded: true });
  }
  if (activeConversationId() === conversationId) setMessages(messages);
}
