import { ApiRequestError } from "@/api/client";
import { globalMistyApi } from "@/features/global-search/globalMistyApi";
import { normalizeConversation } from "@/features/global-search/globalSearchStoreHelpers";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { isStoredChat, localChats, mergeConversation } from "./localChats";

/** This computer's id on the account, or null outside the desktop app. */
export async function thisDeviceId(): Promise<string | null> {
  const { thisComputerDeviceId } = await import("@/features/agents/workflows/deviceScheduledRuns");
  return thisComputerDeviceId().catch(() => null);
}

/** How long a reply may show as running before a missing run counts as gone. */
const staleAfterMs = 10 * 60_000;

/** Marks replies still shown as running, whose run is gone, as not finished. */
function settleStaleReplies(conversation: GlobalAiConversation): GlobalAiConversation {
  const stale = (message: GlobalAiConversation["messages"][number]) =>
    (message.state === "pending" || message.state === "streaming") &&
    Date.now() - Date.parse(message.createdAt) > staleAfterMs;
  if (!conversation.messages.some(stale)) return conversation;
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      stale(message)
        ? {
            ...message,
            state: "failed" as const,
            retryable: true,
            content: message.content || "This run stopped before it finished.",
          }
        : message,
    ),
  };
}

/** Takes a chat for this device; false when another device already has it. */
async function keep(conversationId: string, deviceId: string): Promise<boolean> {
  try {
    await globalMistyApi.keepConversationOnDevice(conversationId, deviceId);
    return true;
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === "kept_elsewhere") return false;
    // Offline or a server error: keep the copy, and take it on a later load.
    return true;
  }
}

/**
 * Takes a chat this device continues but does not keep yet (one from before chats moved
 * to devices), so its later runs are not retained on the server. Returns the device id.
 */
export async function keepChatOnThisDevice(conversationId: string): Promise<string | null> {
  const deviceId = await thisDeviceId();
  if (!deviceId) return null;
  return (await keep(conversationId, deviceId)) ? deviceId : null;
}

/**
 * This device's chats, brought up to date with what the server holds for it
 * (docs/design/agent-chats-local/BRIEF.md):
 * - once, a copy of every chat from before chats moved to devices;
 * - its own chats that ran in the last two days, merged turn by turn;
 * - the inbox: chats Misty started by email, Slack or a schedule, which the
 *   first device to see them takes.
 * Everything changed is saved here. A failed server call leaves the local copy as it is.
 */
export async function syncLocalChats(
  accountId: string,
  local: GlobalAiConversation[],
): Promise<GlobalAiConversation[]> {
  const byId = new Map(local.map((conversation) => [conversation.id, conversation]));
  const changed = new Map<string, GlobalAiConversation>();
  if (!(await localChats.imported(accountId, "chats").catch(() => true))) {
    const legacy = await globalMistyApi.conversationsInScope("legacy").catch(() => null);
    if (legacy) {
      for (const conversation of legacy.conversations.map(normalizeConversation)) {
        if (byId.has(conversation.id)) continue;
        byId.set(conversation.id, conversation);
        changed.set(conversation.id, conversation);
      }
      await Promise.all(
        [...changed.values()].map((c) => localChats.saveConversation(accountId, c)),
      );
      await localChats.markImported(accountId, "chats");
      changed.clear();
    }
  }
  const deviceId = await thisDeviceId();
  if (deviceId) {
    const fresh = await globalMistyApi.conversationsInScope("device", deviceId).catch(() => null);
    for (const server of (fresh?.conversations ?? []).map(normalizeConversation)) {
      if (!server.keptOnDeviceId && !(await keep(server.id, deviceId))) {
        // Another device took it first: it is that device's chat.
        if (byId.delete(server.id)) await localChats.deleteConversation(accountId, server.id);
        continue;
      }
      const merged = mergeConversation(byId.get(server.id), {
        ...server,
        keptOnDeviceId: deviceId,
      });
      byId.set(server.id, merged);
      changed.set(server.id, merged);
    }
    if (fresh) {
      // A reply saved mid-run whose run the server no longer holds will never finish.
      const live = new Set(fresh.conversations.map((conversation) => conversation.id));
      for (const conversation of byId.values()) {
        if (live.has(conversation.id)) continue;
        const settled = settleStaleReplies(conversation);
        if (settled === conversation) continue;
        byId.set(conversation.id, settled);
        changed.set(conversation.id, settled);
      }
    }
  }
  await Promise.all(
    [...changed.values()].map((conversation) =>
      localChats.saveConversation(accountId, conversation).catch(() => undefined),
    ),
  );
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * Saves each conversation that changed since the last save, a moment after its last
 * change, so a streaming reply is written once it pauses rather than on every word.
 */
export function persistLocalChats(
  subscribe: (
    listener: (
      state: { accountId: string; conversations: GlobalAiConversation[] },
      previous: { accountId: string; conversations: GlobalAiConversation[] },
    ) => void,
  ) => () => void,
): () => void {
  if (!localChats.available()) return () => undefined;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const latest = new Map<string, { accountId: string; conversation: GlobalAiConversation }>();
  return subscribe((state, previous) => {
    if (!state.accountId || state.conversations === previous.conversations) return;
    if (state.accountId !== previous.accountId) return;
    const before = new Map(previous.conversations.map((c) => [c.id, c]));
    for (const conversation of state.conversations) {
      if (before.get(conversation.id) === conversation || isStoredChat(conversation)) continue;
      latest.set(conversation.id, { accountId: state.accountId, conversation });
      clearTimeout(timers.get(conversation.id));
      timers.set(
        conversation.id,
        setTimeout(() => {
          timers.delete(conversation.id);
          const entry = latest.get(conversation.id);
          latest.delete(conversation.id);
          if (entry)
            void localChats
              .saveConversation(entry.accountId, entry.conversation)
              .catch(() => undefined);
        }, 400),
      );
    }
  });
}
