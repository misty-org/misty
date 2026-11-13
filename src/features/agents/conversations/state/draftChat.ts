import { moveBrowserChat } from "../../agent-browser/agentBrowserStore";
import { useSessionGoals } from "../../goals/sessionGoals";

/**
 * Where a chat that hasn't started keeps what the person sets on it before its first message (its
 * goal, its browser), so the rail's tools work on an empty chat too. The same key the composer's
 * browser attachment uses for it.
 */
export const DRAFT_CHAT = "draft";

/** The key a chat's goal and browser live under: its id, or `DRAFT_CHAT` before it has one. */
export const chatKey = (conversationId: string | null | undefined) =>
  conversationId || DRAFT_CHAT;

/** The first message gave the chat its id: what was set on it while empty becomes its own. */
export function adoptDraftChat(conversationId: string) {
  if (!conversationId || conversationId === DRAFT_CHAT) return;
  useSessionGoals.getState().move(DRAFT_CHAT, conversationId);
  moveBrowserChat(DRAFT_CHAT, conversationId);
}
