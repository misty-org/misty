import { invoke } from "@tauri-apps/api/core";
import type { AgentConversationFolder } from "../../api/conversation_folders";
import type { GlobalAiConversation, GlobalAiMessage } from "./conversation_types";
import { hasTauriInternals } from "@/shared/platform/tauri";

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

export const localDocuments = {
  available: () => hasTauriInternals(),
  list: (account: string, kind: Kind) => invoke<string[]>("agent_chats_list", { account, kind }),
  get: (account: string, kind: Kind, id: string) =>
    invoke<string | null>("agent_chats_get", { account, kind, id }),
  swap: (account: string, kind: Kind, id: string, expected: string | null, document: string) =>
    invoke<boolean>("agent_chats_swap", { account, kind, id, expected, document }),
  remove: (account: string, kind: Kind, id: string) => remove(account, kind, id),
};

const stored = new WeakSet<GlobalAiConversation>();
const storedMessageDocuments = new Map<string, Map<string, string>>();

function chatKey(account: string, conversation: string) {
  return `${account}\0${conversation}`;
}

function storableMessage(message: GlobalAiMessage): GlobalAiMessage {
  const { activity: _activity, ...storedMessage } = message;
  return storedMessage;
}

const documentsByMessage = new WeakMap<GlobalAiMessage, string>();

function messageDocument(message: GlobalAiMessage): string {
  let document = documentsByMessage.get(message);
  if (document === undefined) {
    document = JSON.stringify(storableMessage(message));
    documentsByMessage.set(message, document);
  }
  return document;
}

function messageDocuments(conversation: GlobalAiConversation): Map<string, string> {
  return new Map(conversation.messages.map((message) => [message.id, messageDocument(message)]));
}

export function markStoredChats(conversations: GlobalAiConversation[], account?: string): void {
  for (const conversation of conversations) {
    stored.add(conversation);
    if (account)
      storedMessageDocuments.set(chatKey(account, conversation.id), messageDocuments(conversation));
  }
}

function sameMessage(a: GlobalAiMessage, b: GlobalAiMessage): boolean {
  return a === b || (a.activity === b.activity && messageDocument(a) === messageDocument(b));
}

export function keepUnchangedChats(
  previous: GlobalAiConversation[],
  next: GlobalAiConversation[],
): GlobalAiConversation[] {
  if (!previous.length) return next;
  const before = new Map(previous.map((conversation) => [conversation.id, conversation]));
  let changed = previous.length !== next.length;
  const kept = next.map((conversation, index) => {
    const old = before.get(conversation.id);
    if (!old) {
      changed = true;
      return conversation;
    }
    const oldMessages = new Map(old.messages.map((message) => [message.id, message]));
    let messagesChanged = old.messages.length !== conversation.messages.length;
    const messages = conversation.messages.map((message, at) => {
      const match = oldMessages.get(message.id);
      if (match && sameMessage(match, message)) {
        if (old.messages[at] !== match) messagesChanged = true;
        return match;
      }
      messagesChanged = true;
      return message;
    });
    const same =
      !messagesChanged &&
      old.messageBeforeSeq === conversation.messageBeforeSeq &&
      Boolean(old.hasOlderMessages) === Boolean(conversation.hasOlderMessages) &&
      JSON.stringify(storable(old)) === JSON.stringify(storable(conversation));
    if (same) {
      if (previous[index] !== old) changed = true;
      return old;
    }
    changed = true;
    return messagesChanged
      ? { ...conversation, messages }
      : { ...conversation, messages: old.messages };
  });
  return changed ? kept : previous;
}

export function isStoredChat(conversation: GlobalAiConversation): boolean {
  return stored.has(conversation);
}

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
      messages: changedMessages.map(messageDocument),
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
        if (Array.isArray(conversation.messages)) {
          return {
            ...conversation,
            messageBeforeSeq: conversation.messageBeforeSeq ?? undefined,
            hasOlderMessages: Boolean(conversation.hasOlderMessages),
          };
        }
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
    await remove(account, "collaboration", id).catch(() => undefined);
    await remove(account, "notebook", `conversation:${id}`).catch(() => undefined);
  },
  folders: (account: string) => list<AgentConversationFolder>(account, "folder"),
  saveFolder: (account: string, folder: AgentConversationFolder) =>
    put(account, "folder", folder.id, folder),
  deleteFolder: (account: string, id: string) => remove(account, "folder", id),
  lessons: <T>(account: string) => list<T>(account, "lesson"),
  saveLesson: (account: string, lesson: { id: string }) =>
    put(account, "lesson", lesson.id, lesson),
  deleteLesson: (account: string, id: string) => remove(account, "lesson", id),
  courses: <T>(account: string) => list<T>(account, "course"),
  saveCourse: (account: string, course: { id: string }) =>
    put(account, "course", course.id, course),
  tutor: <T>(account: string, kind: TutorKind) => list<T>(account, kind),
  saveTutor: (account: string, kind: TutorKind, item: { id: string }) =>
    put(account, kind, item.id, item),
  deleteTutor: (account: string, kind: TutorKind, id: string) => remove(account, kind, id),
};

export type TutorKind =
  "tutor_notebook" | "tutor_deck" | "tutor_guide" | "tutor_job" | "tutor_index";

const historyTurnLimit = 120;
const historyCharacterLimit = 400_000;

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
