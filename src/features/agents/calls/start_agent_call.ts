import type { AgentProfile } from "@/shared/schemas";
import { newLocalConversation } from "../conversations/state/local_conversation";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { openAgentThread } from "../tutor/cursor/tutor_handoff";
import { agentCallsHost } from "./agent_calls_host";

export function startAgentCall(input: {
  agent: AgentProfile;
  conversationId?: string;
  video: boolean;
  sees: boolean;
}) {
  const host = agentCallsHost.maybe();
  if (!host) return;
  let conversationId = input.conversationId;
  if (!conversationId) {
    const thread = newLocalConversation("New conversation", undefined, input.agent.id);
    useMistyStore.setState((state) => ({
      conversations: [thread, ...state.conversations.filter((c) => c.id !== thread.id)],
    }));
    conversationId = thread.id;
    openAgentThread(input.agent.id, conversationId);
  }
  host.start({ agent: input.agent, conversationId, video: input.video, sees: input.sees });
}
