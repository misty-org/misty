import { notify } from "@misty/ui";
import { useSpeechModels } from "@/features/voice";
import type { AgentProfile } from "@/shared/schemas";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";
import { agentVoiceState, voiceProgress, voiceSetupLine } from "../../personal/agent_voice";
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

export function taskVoice(
  s: CursorCompanionSession,
  invocationId: string,
): string | undefined | null {
  const agent = taskAgent(s, invocationId);
  const state = agentVoiceState(agent);
  if (state.kind === "none") return undefined;
  if (state.kind === "ready") return state.voice;
  const speech = useSpeechModels.getState();
  const entry = speech.catalog?.voices.find((item) => item.id === state.voice);
  const fetching =
    voiceProgress(speech.progress, entry ?? { id: state.voice, packageKey: state.voice }) ||
    speech.catalog?.installing.some((id) => id === state.voice || id === entry?.packageKey);
  if (!fetching) void speech.install(state.voice);
  notify({ message: voiceSetupLine(agent?.name ?? "") });
  return null;
}
