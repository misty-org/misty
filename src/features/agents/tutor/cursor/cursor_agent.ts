import {
  effectiveValues,
  useDevicePreferences,
  writeDevicePreference,
} from "@/features/settings/preference_access";
import type { AgentProfile } from "@/shared/schemas";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";
import type { PresentedAgent } from "./protocol";

const cursorAgentSetting = "agents.companion.agent";

const chosen = (values: Record<string, unknown>): string => {
  const value = values[cursorAgentSetting];
  return typeof value === "string" ? value : "";
};

export const cursorAgents = (agents: AgentProfile[]) =>
  agents.filter((agent) => !agent.system_managed);

const pick = (agents: AgentProfile[], id: string) => {
  const own = cursorAgents(agents);
  return own.find((agent) => agent.id === id) ?? own[0];
};

export function cursorAgent(): AgentProfile | undefined {
  const state = useDevicePreferences.getState().state;
  return pick(
    usePersonalAgentsStore.getState().agents,
    state ? chosen(effectiveValues(state)) : "",
  );
}

export function useCursorAgent(): AgentProfile | undefined {
  const id = useDevicePreferences((store) =>
    store.state ? chosen(effectiveValues(store.state)) : "",
  );
  const agents = usePersonalAgentsStore((state) => state.agents);
  return pick(agents, id);
}

export const setCursorAgent = (id: string) => writeDevicePreference(cursorAgentSetting, id);

const faceMost = 4_000;

export function cursorFace(): PresentedAgent | undefined {
  const agent = cursorAgent();
  if (!agent) return undefined;
  const face = { id: agent.id, name: agent.name, engine: agent.engine, avatar: agent.avatar };
  return JSON.stringify(face.avatar ?? {}).length > faceMost ? { ...face, avatar: {} } : face;
}
