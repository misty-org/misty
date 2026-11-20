import type {
  GlobalAiConversation,
  GlobalAiMessage,
} from "../../conversations/state/conversationTypes";
import { localChats } from "../../conversations/state/localChats";
import { newLocalConversation } from "../../conversations/state/localConversation";
import { useMistyStore } from "../../conversations/state/useMistyStore";

/**
 * Tutor's own conversation at the cursor: what was asked aloud or in its text box, and what it
 * answered. It is kept on this device like any chat (`place: "tutor"`), never listed with the
 * chats, never synced and never an agent's. Work Tutor hands off goes to an agent's own thread
 * (`tutorHandoff.ts`); this conversation keeps only a link to it.
 */

/** How long Tutor keeps a turn: a day, enough to look back on, never a history. */
export const tutorKeepMs = 24 * 60 * 60 * 1000;

const kept = (message: GlobalAiMessage, now: number) =>
  now - Date.parse(message.createdAt) < tutorKeepMs;

/** The account's Tutor conversation, if there is one: the most recently used. */
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

/** Tutor's turns from the last day, oldest first; older ones drop out. */
export function keptTutorTurns(conversation: GlobalAiConversation): GlobalAiConversation {
  const now = Date.now();
  const messages = conversation.messages.filter((message) => kept(message, now));
  return messages.length === conversation.messages.length
    ? conversation
    : { ...conversation, messages };
}

/** Whether nothing in the conversation is from the last day, so it is started afresh. */
function stale(conversation: GlobalAiConversation) {
  const now = Date.now();
  return (
    now - Date.parse(conversation.updatedAt) >= tutorKeepMs &&
    !conversation.messages.some((message) => kept(message, now))
  );
}

/**
 * Tutor's conversation, made on first use. One whose last turn is more than a day old is deleted
 * and a fresh one started, so turns past the loaded page don't linger either.
 */
export async function tutorConversation(): Promise<string> {
  const state = useMistyStore.getState();
  const current = tutorConversationOf(state.conversations);
  if (current && !stale(current)) return current.id;
  if (current) {
    // Straight from this device's chats: Tutor's conversation is never open, so nothing else
    // in the window changes with it.
    await localChats.deleteConversation(state.accountId, current.id).catch(() => undefined);
    useMistyStore.setState((now) => ({
      conversations: now.conversations.filter((c) => c.id !== current.id),
    }));
  }
  if (useMistyStore.getState().accountId !== state.accountId)
    throw new Error("Voice session canceled.");
  // Again, in case another turn made one while the old one was deleted.
  const made = tutorConversationOf(useMistyStore.getState().conversations);
  if (made && !stale(made)) return made.id;
  const conversation = newLocalConversation("Tutor", undefined, undefined, "tutor");
  useMistyStore.setState((current) => ({
    conversations: [conversation, ...current.conversations.filter((c) => c.id !== conversation.id)],
  }));
  return conversation.id;
}

/** One exchange with Tutor, as Recent lists it. */
export interface TutorTurn {
  id: string;
  asked: string;
  answered: string;
  createdAt: string;
  handoff?: { agentId: string; conversationId: string };
}

/** Tutor's turns from the last day, newest first. */
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
