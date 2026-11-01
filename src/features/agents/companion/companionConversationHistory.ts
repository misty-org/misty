import type { GlobalAiConversation, GlobalAiMessage } from "@/features/misty/types";
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

/** The last turns of a chat as JSON data for the voice: what was asked, answered and done. */
export function voiceContext(conversation: GlobalAiConversation | undefined): string {
  if (!conversation) return "[]";
  const rows: Array<{ user: string; assistant: string; state: string; invocation_id: string }> = [];
  for (const message of conversation.messages) {
    if (message.role === "user")
      rows.push({
        user: message.content.slice(0, 1600),
        assistant: "",
        state: message.state ?? "",
        invocation_id: "",
      });
    else if (rows.length) {
      const row = rows[rows.length - 1]!;
      row.assistant = message.content.slice(0, 2400);
      row.state = message.state ?? row.state;
      row.invocation_id = message.invocationId ?? "";
    }
  }
  return JSON.stringify(rows.slice(-8));
}
