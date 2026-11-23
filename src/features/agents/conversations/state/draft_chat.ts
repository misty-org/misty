import { moveBrowserChat } from "../../agent-browser/agent_browser_store";
import { useSessionGoals } from "../../goals/session_goals";

export const DRAFT_CHAT = "draft";

export const chatKey = (conversationId: string | null | undefined) => conversationId || DRAFT_CHAT;

export function adoptDraftChat(conversationId: string) {
  if (!conversationId || conversationId === DRAFT_CHAT) return;
  useSessionGoals.getState().move(DRAFT_CHAT, conversationId);
  moveBrowserChat(DRAFT_CHAT, conversationId);
}
