import {
  routeLocalFollowup,
  useCompanionState,
  useLocalExecution,
  usePersonalAgentsStore,
} from "@/features/agents";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { matchVocative, type Vocative } from "./vocative";

/** "Hey <agent>, …" against the person's agents, or null. */
export function findVocative(transcript: string): Vocative | null {
  const agents = usePersonalAgentsStore
    .getState()
    .agents.filter((agent) => agent.enabled !== false)
    .map((agent) => ({ id: agent.id, name: agent.name }));
  return matchVocative(transcript, agents);
}

/**
 * Sends the message to the named agent instead of typing it: as a follow-up
 * when that agent is already working on screen, otherwise as a new request
 * through the agent at your cursor.
 */
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
