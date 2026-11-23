import { routeLocalFollowup } from "../../runs/local-execution/local_execution_followups";
import { useCompanionState } from "./companion_state";
import { useLocalExecution } from "../../runs/local-execution/local_execution_state";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { matchVocative, type Vocative } from "@/features/voice";

export function findVocative(transcript: string): Vocative | null {
  const agents = usePersonalAgentsStore
    .getState()
    .agents.filter((agent) => agent.enabled !== false)
    .map((agent) => ({ id: agent.id, name: agent.name }));
  return matchVocative(transcript, agents);
}

export async function routeToAgent({ agent, message }: Vocative) {
  if (useLocalExecution.getState().execution?.agentId === agent.id) {
    await routeLocalFollowup(message);
    return;
  }
  const submit = useCompanionState.getState().submit;
  if (!submit) throw new Error("Agents are starting. Try again in a moment.");
  useMistyStore.setState({ selectedAgentId: agent.id });
  await submit({ prompt: message, conversationId: "" });
}
