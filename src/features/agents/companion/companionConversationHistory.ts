import type { GlobalAiConversation, GlobalAiMessage } from "@/features/global-search/types";
import type { SavedVoiceTurn } from "./companionConversation";

/** Keep a voice turn in its original position while a delegated task progresses. */
export function mergeVoiceTurn(
  conversation: GlobalAiConversation,
  saved: SavedVoiceTurn,
): GlobalAiConversation {
  const userId = `${saved.id}-user`,
    assistantId = `${saved.id}-assistant`;
  const previous = conversation.messages.find((m) => m.id === userId);
  const createdAt = previous?.createdAt ?? new Date().toISOString();
  const user: GlobalAiMessage = {
    id: userId,
    role: "user",
    mode: "ask",
    content: saved.prompt,
    state: "completed",
    createdAt,
  };
  const messages = conversation.messages
    .filter((m) => m.id !== assistantId)
    .map((m) => (m.id === userId ? user : m));
  if (!previous) messages.push(user);
  if (saved.reply)
    messages.splice(messages.findIndex((m) => m.id === userId) + 1, 0, {
      id: assistantId,
      invocationId: saved.id,
      role: "assistant",
      mode: "ask",
      content: saved.reply,
      state: "completed",
      createdAt: new Date().toISOString(),
    });
  return {
    ...conversation,
    title:
      conversation.title === "New conversation" ? saved.prompt.slice(0, 56) : conversation.title,
    messages,
  };
}
