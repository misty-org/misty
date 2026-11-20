import { invoke } from "@tauri-apps/api/core";
import type { AgentConversationFolder } from "../../api/conversation-folders";
import type { GlobalAiConversation, GlobalAiMessage } from "./conversationTypes";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Agent chats live on this device. Conversation metadata and each message are separate rows in
 * misty.db, so long-running agent threads load and save a bounded window at a time.
 */

type Kind =
  | "conversation"
  | "folder"
  | "lesson"
  | "course"
  | "collaboration"
  | "notebook"
  | "run"
  | "agent"
  | "attachment"
  | "artifact"
  | "composer"
  | "tutor_notebook"
  | "tutor_deck"
  | "tutor_guide"
  | "tutor_job"
  | "tutor_index"
  | "studio";

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

/** One document at a time, for state two windows may change at once. */
export const localDocuments = {
  available: () => hasTauriInternals(),
  list: (account: string, kind: Kind) => invoke<string[]>("agent_chats_list", { account, kind }),
  get: (account: string, kind: Kind, id: string) =>
    invoke<string | null>("agent_chats_get", { account, kind, id }),
  /** Writes only if the row still holds `expected` (null: no row yet). False if it no longer does. */
  swap: (account: string, kind: Kind, id: string, expected: string | null, document: string) =>
    invoke<boolean>("agent_chats_swap", { account, kind, id, expected, document }),
  remove: (account: string, kind: Kind, id: string) => remove(account, kind, id),
};

/** Conversation objects known to match what is saved, so loading them writes nothing. */
const stored = new WeakSet<GlobalAiConversation>();
const storedMessageDocuments = new Map<string, Map<string, string>>();

function chatKey(account: string, conversation: string) {
  return `${account}\0${conversation}`;
}

function storableMessage(message: GlobalAiMessage): GlobalAiMessage {
  const { activity: _activity, ...storedMessage } = message;
  return storedMessage;
}

function messageDocuments(conversation: GlobalAiConversation): Map<string, string> {
  return new Map(
    conversation.messages.map((message) => [
      message.id,
      JSON.stringify(storableMessage(message)),
    ]),
  );
}

export function markStoredChats(
  conversations: GlobalAiConversation[],
  account?: string,
): void {
  for (const conversation of conversations) {
    stored.add(conversation);
    if (account) storedMessageDocuments.set(chatKey(account, conversation.id), messageDocuments(conversation));
  }
}

export function isStoredChat(conversation: GlobalAiConversation): boolean {
  return stored.has(conversation);
}

/** Turn state that only means something while this app is open. */
function storable(conversation: GlobalAiConversation): GlobalAiConversation {
  const {
    messages: _messages,
    messageBeforeSeq: _messageBeforeSeq,
    hasOlderMessages: _hasOlderMessages,
    ...metadata
  } = conversation;
  return metadata as GlobalAiConversation;
}

export interface LocalChatMessagePage {
  messages: GlobalAiMessage[];
  beforeSeq?: number;
  hasOlder: boolean;
}

const messagePageSize = 50;

async function saveConversation(
  account: string,
  conversation: GlobalAiConversation,
  changedMessages: GlobalAiMessage[] = conversation.messages,
  deletedMessages: string[] = [],
): Promise<void> {
  if (!hasTauriInternals() || !account) return;
  await put(account, "conversation", conversation.id, storable(conversation));
  if (changedMessages.length || deletedMessages.length) {
    await invoke("agent_chats_messages_upsert", {
      account,
      conversation: conversation.id,
      messages: changedMessages.map((message) => JSON.stringify(storableMessage(message))),
      deleted: deletedMessages,
    });
  }
  storedMessageDocuments.set(chatKey(account, conversation.id), messageDocuments(conversation));
  stored.add(conversation);
}

async function saveChangedConversation(
  account: string,
  conversation: GlobalAiConversation,
): Promise<void> {
  const key = chatKey(account, conversation.id);
  const known = storedMessageDocuments.get(key) ?? new Map<string, string>();
  const current = messageDocuments(conversation);
  const changedMessages = conversation.messages.filter(
    (message) => known.get(message.id) !== current.get(message.id),
  );
  const deletedMessages = [...known.keys()].filter((id) => !current.has(id));
  await saveConversation(account, conversation, changedMessages, deletedMessages);
}

async function messagesPage(
  account: string,
  conversation: string,
  beforeSeq?: number,
): Promise<LocalChatMessagePage> {
  if (!hasTauriInternals() || !account) return { messages: [], hasOlder: false };
  const page = await invoke<{
    messages: string[];
    beforeSeq: number | null;
    hasOlder: boolean;
  }>("agent_chats_messages_page", {
    account,
    conversation,
    beforeSeq: beforeSeq ?? null,
    limit: messagePageSize,
  });
  const messages = page.messages.flatMap((document) => {
    try {
      return [JSON.parse(document) as GlobalAiMessage];
    } catch {
      return [];
    }
  });
  return { messages, beforeSeq: page.beforeSeq ?? undefined, hasOlder: page.hasOlder };
}

export const localChats = {
  available: () => hasTauriInternals(),
  conversations: async (account: string) => {
    const conversations = await list<GlobalAiConversation>(account, "conversation");
    return Promise.all(
      conversations.map(async (conversation) => {
        const page = await messagesPage(account, conversation.id);
        return {
          ...conversation,
          messages: page.messages,
          messageBeforeSeq: page.beforeSeq,
          hasOlderMessages: page.hasOlder,
        };
      }),
    );
  },
  saveConversation,
  saveChangedConversation,
  messagesPage,
  deleteConversation: async (account: string, id: string) => {
    await remove(account, "conversation", id);
    storedMessageDocuments.delete(chatKey(account, id));
    // Its plans, goal, questions and notebook go with it.
    await remove(account, "collaboration", id).catch(() => undefined);
    await remove(account, "notebook", `conversation:${id}`).catch(() => undefined);
  },
  folders: (account: string) => list<AgentConversationFolder>(account, "folder"),
  saveFolder: (account: string, folder: AgentConversationFolder) =>
    put(account, "folder", folder.id, folder),
  deleteFolder: (account: string, id: string) => remove(account, "folder", id),
  /** A Teach-mode chat's lesson progress (src/features/agents/tutor/lessons), keyed by the chat. */
  lessons: <T>(account: string) => list<T>(account, "lesson"),
  saveLesson: (account: string, lesson: { id: string }) =>
    put(account, "lesson", lesson.id, lesson),
  deleteLesson: (account: string, id: string) => remove(account, "lesson", id),
  /** A broad topic's lessons in order (Teach mode). */
  courses: <T>(account: string) => list<T>(account, "course"),
  saveCourse: (account: string, course: { id: string }) =>
    put(account, "course", course.id, course),
  /** Tutor's notebooks, decks, guides and runs (src/features/agents/tutor). */
  tutor: <T>(account: string, kind: TutorKind) => list<T>(account, kind),
  saveTutor: (account: string, kind: TutorKind, item: { id: string }) =>
    put(account, kind, item.id, item),
  deleteTutor: (account: string, kind: TutorKind, id: string) => remove(account, kind, id),
};

export type TutorKind =
  "tutor_notebook" | "tutor_deck" | "tutor_guide" | "tutor_job" | "tutor_index";

/** Bounds what a turn carries: the run trims it further to the model's window. */
const historyTurnLimit = 120;
const historyCharacterLimit = 400_000;

/** The earlier turns of a chat, oldest first, for the next turn's prompt. */
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
      // With its requirements ledger, as the person may have edited it.
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
