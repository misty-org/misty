import { startRun } from "./start_run";
import { newLocalConversation } from "./state/local_conversation";
import { useMistyStore } from "./state/use_misty_store";
import { resumeEngineSession } from "./view/engine/engine_history";
import { syncEngineSession } from "./view/engine/engine_session_import";

export async function askInNewChat(agentId: string, prompt: string) {
  const title = prompt.trim().replace(/\s+/g, " ").slice(0, 80);
  const started = await startRun({ agentId, title, prompt, mode: "act", background: false });
  if (started.error) throw new Error(started.error);
  return started.conversationId;
}

export async function resumeInNewChat(
  agentId: string,
  session: { engine: string; sessionId: string; workspacePath: string; title: string },
) {
  const conversation = newLocalConversation(session.title, undefined, agentId);
  useMistyStore.setState((state) => ({
    conversations: [conversation, ...state.conversations.filter((c) => c.id !== conversation.id)],
  }));
  await resumeEngineSession(conversation.id, session);
  await syncEngineSession(conversation.id, session).catch(() => undefined);
  return conversation.id;
}
