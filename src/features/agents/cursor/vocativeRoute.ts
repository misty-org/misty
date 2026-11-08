import { routeLocalFollowup } from "../runs/local-execution/localExecutionFollowups";
import { useCompanionState } from "./companionState";
import { useLocalExecution } from "../runs/local-execution/localExecutionState";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { matchVocative, type Vocative } from "@/features/voice";

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
 * that answers in its chat. Nothing shows at the cursor: only the talk shortcut does that.
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
