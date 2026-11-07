import { readRunState } from "@/features/ai-surface/invocationSubscription";
import type { GlobalAiConversation } from "./types";
import { isStoredChat, localChats } from "./localChats";

const open = (message: GlobalAiConversation["messages"][number]) =>
  message.role === "assistant" && (message.state === "pending" || message.state === "streaming");

/**
 * Whether a reply saved mid-run still has a run behind it. A run outlives the app (native code picks it
 * up from its file at launch, `resume_unfinished`), so only native code can say: a reply stays open
 * while its run goes on, and one nothing knows of is settled, or it would show as working forever.
 */
async function settleOrphanedReplies(
  conversation: GlobalAiConversation,
  running: string | undefined,
): Promise<GlobalAiConversation> {
  const replies = conversation.messages.filter(open);
  if (!replies.length) return conversation;
  const orphaned = new Set<string>();
  await Promise.all(
    replies.map(async (message) => {
      if (message.invocationId && message.invocationId === running) return;
      const state = message.invocationId
        ? await readRunState(message.invocationId).catch(() => "unknown")
        : "missing";
      if (state === "missing") orphaned.add(message.id);
    }),
  );
  if (!orphaned.size) return conversation;
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      orphaned.has(message.id)
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

/** This device's chats, with replies whose run is gone settled and saved. */
export async function syncLocalChats(
  accountId: string,
  local: GlobalAiConversation[],
  runningInvocation: () => string | undefined = () => undefined,
): Promise<GlobalAiConversation[]> {
  const settled = await Promise.all(
    local.map(async (conversation) => {
      const next = await settleOrphanedReplies(conversation, runningInvocation());
      if (next !== conversation)
        await localChats.saveConversation(accountId, next).catch(() => undefined);
      return next;
    }),
  );
  return settled.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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
