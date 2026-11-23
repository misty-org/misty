import type { GlobalAiConversation } from "./conversation_types";
import { useMistyStore } from "./use_misty_store";

type Organizing = Pick<
  GlobalAiConversation,
  "pinnedAt" | "archivedAt" | "markedUnread" | "lastReadAt" | "folderId"
>;

function organize(ids: string[], change: (chat: GlobalAiConversation) => Partial<Organizing>) {
  const picked = new Set(ids);
  useMistyStore.setState((state) => ({
    conversations: state.conversations.map((chat) =>
      picked.has(chat.id) ? { ...chat, ...change(chat) } : chat,
    ),
  }));
}

export function isChatUnread(
  chat: Pick<GlobalAiConversation, "markedUnread" | "lastReadAt" | "updatedAt">,
): boolean {
  if (chat.markedUnread) return true;
  if (!chat.lastReadAt) return false;
  return (Date.parse(chat.updatedAt) || 0) > (Date.parse(chat.lastReadAt) || 0);
}

export const setChatsPinned = (ids: string[], pinned: boolean) =>
  organize(ids, () => ({ pinnedAt: pinned ? new Date().toISOString() : undefined }));

export const setChatsArchived = (ids: string[], archived: boolean) =>
  organize(ids, () =>
    archived
      ? { archivedAt: new Date().toISOString(), pinnedAt: undefined }
      : { archivedAt: undefined },
  );

export const setChatsUnread = (ids: string[], unread: boolean) =>
  organize(ids, () =>
    unread
      ? { markedUnread: true }
      : { markedUnread: undefined, lastReadAt: new Date().toISOString() },
  );

export const fileChats = (ids: string[], sectionId: string) =>
  organize(ids, () => ({ folderId: sectionId || undefined }));

export function forkChat(id: string): string | null {
  const source = useMistyStore.getState().conversations.find((chat) => chat.id === id);
  if (!source) return null;
  const now = new Date().toISOString();
  const fork: GlobalAiConversation = {
    ...source,
    id: `conversation_${crypto.randomUUID()}`,
    title: `${source.title || "New conversation"} (fork)`,
    createdAt: now,
    updatedAt: now,
    lastReadAt: now,
    markedUnread: undefined,
    pinnedAt: undefined,
    archivedAt: undefined,
    messages: source.messages
      .filter((message) => message.state !== "pending" && message.state !== "streaming")
      .map(({ activity: _activity, ...message }) => message),
  };
  useMistyStore.setState((state) => ({ conversations: [fork, ...state.conversations] }));
  return fork.id;
}
