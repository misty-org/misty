import type {
  GlobalAiConversation,
  GlobalAiMessage,
} from "../../conversations/state/conversation_types";
import { localChats } from "../../conversations/state/local_chats";
import { newLocalConversation } from "../../conversations/state/local_conversation";
import { useMistyStore } from "../../conversations/state/use_misty_store";

export const tutorKeepMs = 24 * 60 * 60 * 1000;

const kept = (message: GlobalAiMessage, now: number) =>
  now - Date.parse(message.createdAt) < tutorKeepMs;

export function tutorConversationOf(
  conversations: GlobalAiConversation[],
): GlobalAiConversation | undefined {
  let found: GlobalAiConversation | undefined;
  for (const conversation of conversations)
    if (
      conversation.place === "tutor" &&
      !conversation.archivedAt &&
      (!found || conversation.updatedAt > found.updatedAt)
    )
      found = conversation;
  return found;
}

export function keptTutorTurns(conversation: GlobalAiConversation): GlobalAiConversation {
  const now = Date.now();
  const messages = conversation.messages.filter((message) => kept(message, now));
  return messages.length === conversation.messages.length
    ? conversation
    : { ...conversation, messages };
}

function stale(conversation: GlobalAiConversation) {
  const now = Date.now();
  return (
    now - Date.parse(conversation.updatedAt) >= tutorKeepMs &&
    !conversation.messages.some((message) => kept(message, now))
  );
}

export async function tutorConversation(): Promise<string> {
  const state = useMistyStore.getState();
  const current = tutorConversationOf(state.conversations);
  if (current && !stale(current)) return current.id;
  if (current) {
    await localChats.deleteConversation(state.accountId, current.id).catch(() => undefined);
    useMistyStore.setState((now) => ({
      conversations: now.conversations.filter((c) => c.id !== current.id),
    }));
  }
  if (useMistyStore.getState().accountId !== state.accountId)
    throw new Error("Voice session canceled.");
  const made = tutorConversationOf(useMistyStore.getState().conversations);
  if (made && !stale(made)) return made.id;
  const conversation = newLocalConversation("Tutor", undefined, undefined, "tutor");
  useMistyStore.setState((current) => ({
    conversations: [conversation, ...current.conversations.filter((c) => c.id !== conversation.id)],
  }));
  return conversation.id;
}

export interface TutorTurn {
  id: string;
  asked: string;
  answered: string;
  createdAt: string;
  handoff?: { agentId: string; conversationId: string };
}

export function tutorTurns(conversation: GlobalAiConversation | undefined): TutorTurn[] {
  if (!conversation) return [];
  const now = Date.now();
  const turns: TutorTurn[] = [];
  for (const message of conversation.messages) {
    if (!kept(message, now)) continue;
    if (message.role === "user") {
      if (message.content.trim())
        turns.push({
          id: message.id,
          asked: message.content,
          answered: "",
          createdAt: message.createdAt,
        });
      continue;
    }
    const turn = turns[turns.length - 1];
    if (!turn) continue;
    turn.answered = message.content;
    if (message.tutorHandoff) turn.handoff = message.tutorHandoff;
  }
  return turns.reverse();
}
