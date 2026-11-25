import type { AgentProfile } from "@/shared/schemas";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";
import { agentVoice } from "../../personal/agent_voice";
import type { CursorCompanionSession } from "./cursor_companion_session";

function taskAgent(s: CursorCompanionSession, invocationId: string): AgentProfile | undefined {
  const handedTo =
    s.delegatedTask?.id === invocationId ? s.delegatedTask.handoff?.agentId : undefined;
  const chat = useMistyStore
    .getState()
    .conversations.find((c) =>
      c.messages.some((m) => m.role === "assistant" && m.invocationId === invocationId),
    );
  const id = handedTo ?? chat?.agentId;
  if (!id) return undefined;
  return usePersonalAgentsStore
    .getState()
    .agents.find((agent) => agent.id === id && !agent.system_managed);
}

export function taskVoice(s: CursorCompanionSession, invocationId: string): string | undefined {
  return agentVoice(taskAgent(s, invocationId));
}
