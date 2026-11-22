import { startRun } from "./startRun";
import { newLocalConversation } from "./state/localConversation";
import { useMistyStore } from "./state/useMistyStore";
import { resumeEngineSession } from "./view/engine/engineHistory";
import { syncEngineSession } from "./view/engine/engineSessionImport";

/** Sends `prompt` as the first message of a new chat with `agentId`; the chat's id, to open. */
export async function askInNewChat(agentId: string, prompt: string) {
  const title = prompt.trim().replace(/\s+/g, " ").slice(0, 80);
  const started = await startRun({ agentId, title, prompt, mode: "act", background: false });
  if (started.error) throw new Error(started.error);
  return started.conversationId;
}

/**
 * A new chat with `agentId` whose next turn continues an engine's own session, showing that
 * session's earlier turns.
 */
export async function resumeInNewChat(
  agentId: string,
  session: { engine: string; sessionId: string; workspacePath: string; title: string },
) {
  const conversation = newLocalConversation(session.title, undefined, agentId);
  useMistyStore.setState((state) => ({
    conversations: [conversation, ...state.conversations.filter((c) => c.id !== conversation.id)],
  }));
  await resumeEngineSession(conversation.id, session);
  // The session's turns so far; the resume holds even if they can't be read.
  await syncEngineSession(conversation.id, session).catch(() => undefined);
  return conversation.id;
}
