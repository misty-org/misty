import { invoke } from "@tauri-apps/api/core";
import type { AgentConversationFolder } from "@/api/assistant/conversationFolders";
import type { GlobalAiConversation, GlobalAiMessage } from "@/features/global-search/types";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Agent chats live on this device, like Claude Code and Codex
 * (docs/design/agent-chats-local/BRIEF.md): each conversation, with its messages and
 * timelines, is one document in misty.db, and so is each folder. The server only runs
 * a chat's turns, so this device sends each turn the history it keeps.
 */

type Kind = "conversation" | "folder" | "meta" | "lesson" | "course";

async function list<T>(account: string, kind: Kind): Promise<T[]> {
  if (!hasTauriInternals() || !account) return [];
  const documents = await invoke<string[]>("agent_chats_list", { account, kind });
  return documents.flatMap((document) => {
    try {
      return [JSON.parse(document) as T];
    } catch {
      return [];
    }
  });
}

async function put(account: string, kind: Kind, id: string, value: unknown): Promise<void> {
  if (!hasTauriInternals() || !account) return;
  await invoke("agent_chats_put", { account, kind, id, document: JSON.stringify(value) });
}

async function remove(account: string, kind: Kind, id: string): Promise<void> {
  if (!hasTauriInternals() || !account) return;
  await invoke("agent_chats_delete", { account, kind, id });
}

/** Conversation objects known to match what is saved, so loading them writes nothing. */
const stored = new WeakSet<GlobalAiConversation>();

export function markStoredChats(conversations: GlobalAiConversation[]): void {
  for (const conversation of conversations) stored.add(conversation);
}

export function isStoredChat(conversation: GlobalAiConversation): boolean {
  return stored.has(conversation);
}

/** Turn state that only means something while this app is open. */
function storable(conversation: GlobalAiConversation): GlobalAiConversation {
  return {
    ...conversation,
    messages: conversation.messages.map(({ activity: _activity, ...message }) => message),
  };
}

export const localChats = {
  available: () => hasTauriInternals(),
  conversations: (account: string) => list<GlobalAiConversation>(account, "conversation"),
  saveConversation: (account: string, conversation: GlobalAiConversation) =>
    put(account, "conversation", conversation.id, storable(conversation)),
  deleteConversation: (account: string, id: string) => remove(account, "conversation", id),
  folders: (account: string) => list<AgentConversationFolder>(account, "folder"),
  saveFolder: (account: string, folder: AgentConversationFolder) =>
    put(account, "folder", folder.id, folder),
  deleteFolder: (account: string, id: string) => remove(account, "folder", id),
  /** A Teach-mode chat's lesson progress (src/features/agents/lessons), keyed by the chat. */
  lessons: <T>(account: string) => list<T>(account, "lesson"),
  saveLesson: (account: string, lesson: { id: string }) =>
    put(account, "lesson", lesson.id, lesson),
  deleteLesson: (account: string, id: string) => remove(account, "lesson", id),
  /** A broad topic's lessons in order (Teach mode). */
  courses: <T>(account: string) => list<T>(account, "course"),
  saveCourse: (account: string, course: { id: string }) =>
    put(account, "course", course.id, course),
  /** Whether a one-time import (chats or folders from before chats moved here) ran. */
  imported: async (account: string, name: string) =>
    (await list<{ id: string }>(account, "meta")).some((item) => item.id === name),
  markImported: (account: string, name: string) =>
    put(account, "meta", name, { id: name, at: new Date().toISOString() }),
};

/** The run a message belongs to: a reply's own, or for a person's message the reply after it. */
function messageRuns(messages: GlobalAiMessage[]): (string | undefined)[] {
  return messages.map((message, index) => {
    if (message.role === "assistant") return message.invocationId;
    const reply = messages[index + 1];
    return reply?.role === "assistant" ? reply.invocationId : undefined;
  });
}

/**
 * This device's copy of a chat with what the server still holds of it: the server's
 * version of every turn it still has (its newest state), and this device's older turns,
 * which the server no longer keeps. A reply keeps the timeline saved here when the
 * server's copy has none.
 */
export function mergeConversation(
  local: GlobalAiConversation | undefined,
  server: GlobalAiConversation,
): GlobalAiConversation {
  if (!local) return server;
  const serverRuns = new Set(
    server.messages.flatMap((message) => (message.invocationId ? [message.invocationId] : [])),
  );
  const runs = messageRuns(local.messages);
  const kept = local.messages.filter((_, index) => !runs[index] || !serverRuns.has(runs[index]!));
  const localReplies = new Map(
    local.messages.flatMap((message) =>
      message.role === "assistant" && message.invocationId
        ? [[message.invocationId, message] as const]
        : [],
    ),
  );
  const fromServer = server.messages.map((message) => {
    const saved = message.invocationId ? localReplies.get(message.invocationId) : undefined;
    return saved
      ? {
          ...message,
          progress: message.progress ?? saved.progress,
          citations: message.citations ?? saved.citations,
          notebook: message.notebook ?? saved.notebook,
          subagents: message.subagents ?? saved.subagents,
        }
      : message;
  });
  const messages = [...kept, ...fromServer].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  return {
    ...server,
    // The server names a new chat and hears every rename, so its title wins unless it
    // has none yet. Filing and read state belong to this device.
    title: server.title && server.title !== "New conversation" ? server.title : local.title,
    folderId: local.folderId,
    lastReadAt: local.lastReadAt,
    messages,
  };
}

/** Bounds what a turn carries: the server trims it further to the model's window. */
const historyTurnLimit = 120;
const historyCharacterLimit = 400_000;

/** The earlier turns of a chat, oldest first, for the server to put in the next turn's prompt. */
export function historyTurns(
  conversation: GlobalAiConversation | undefined,
): { invocation_id?: string; prompt: string; reply?: string; created_at: string }[] {
  if (!conversation) return [];
  const turns: { invocation_id?: string; prompt: string; reply?: string; created_at: string }[] =
    [];
  const messages = conversation.messages;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role !== "user" || message.source === "continuation") continue;
    const reply = messages[index + 1]?.role === "assistant" ? messages[index + 1] : undefined;
    if (!message.content.trim()) continue;
    // A reply still running is the turn being asked now.
    if (reply && (reply.state === "pending" || reply.state === "streaming")) continue;
    turns.push({
      invocation_id: reply?.invocationId,
      prompt: message.content,
      reply: reply?.content || undefined,
      created_at: message.createdAt,
    });
  }
  const recent = turns.slice(-historyTurnLimit);
  let size = 0;
  let start = recent.length;
  while (start > 0) {
    const turn = recent[start - 1]!;
    size += turn.prompt.length + (turn.reply?.length ?? 0);
    if (size > historyCharacterLimit) break;
    start--;
  }
  return recent.slice(start);
}
