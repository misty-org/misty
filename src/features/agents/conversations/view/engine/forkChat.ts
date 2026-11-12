import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../../personal/agentAccount";
import { useMistyStore } from "../../state/useMistyStore";

/**
 * Forks an engine chat at one of the person's messages: native code writes a new engine session
 * with the history before it, and the new chat resumes that session. The message goes into the
 * composer, to send again or change.
 */
export async function forkEngineChat(input: {
  conversationId: string;
  agentId?: string;
  text: string;
  laterSame: number;
}) {
  const store = useMistyStore.getState();
  const created = await store.newConversation(undefined, input.agentId);
  await invoke("engine_chat_fork", {
    account: agentAccountId(),
    conversation: input.conversationId,
    newConversation: created,
    userText: input.text,
    laterSame: input.laterSame,
  });
  useMistyStore.getState().selectConversation(created);
  useMistyStore.getState().setQuery(input.text);
  return created;
}
