import type { GlobalAiConversation } from "./conversationTypes";
import { useMistyStore } from "./useMistyStore";

/**
 * How the person keeps their chats in order: pinned, archived, read or unread, and filed in a
 * section. Each is a field on the chat, which saves itself on this device when it changes, and
 * none of them touches `updatedAt`, so organizing a chat never moves it in the list.
 */
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

/** Whether a chat has news the person hasn't seen: they marked it, or it changed after they last
 * read it here. A chat never read on this device has no mark to compare with, so it isn't. */
export function isChatUnread(
  chat: Pick<GlobalAiConversation, "markedUnread" | "lastReadAt" | "updatedAt">,
): boolean {
  if (chat.markedUnread) return true;
  if (!chat.lastReadAt) return false;
  return (Date.parse(chat.updatedAt) || 0) > (Date.parse(chat.lastReadAt) || 0);
}

export const setChatsPinned = (ids: string[], pinned: boolean) =>
  organize(ids, () => ({ pinnedAt: pinned ? new Date().toISOString() : undefined }));

/** An archived chat leaves its pin behind, so unarchiving it puts it back among the chats. */
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

/** Files chats in a section, or back among the unfiled chats with an empty id. */
export const fileChats = (ids: string[], sectionId: string) =>
  organize(ids, () => ({ folderId: sectionId || undefined }));

/**
 * A copy of a chat to take somewhere else: its title and turns, under a new id, in the same
 * Space and section. An engine has no session for the copy, so its first turn there is given the
 * earlier turns instead (engines/runs.rs). Returns the copy's id.
 */
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
    // A reply still being written belongs to the run of the chat it came from.
    messages: source.messages
      .filter((message) => message.state !== "pending" && message.state !== "streaming")
      .map(({ activity: _activity, ...message }) => message),
  };
  useMistyStore.setState((state) => ({ conversations: [fork, ...state.conversations] }));
  return fork.id;
}
