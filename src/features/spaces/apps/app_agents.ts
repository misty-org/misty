import { loadRunEntry, usePersonalAgentsStore } from "@/features/agents";

export const AGENT_META = "misty/agent";

export interface AppAgent {
  id: string;
  name: string;
}

const byInstance = new Map<string, Map<string, AppAgent>>();

const listeners = new Map<string, Set<() => void>>();

export async function agentOfRun(runId: string): Promise<AppAgent> {
  const entry = await loadRunEntry(runId).catch(() => null);
  const id = entry?.agentId ?? runId;
  const agent = usePersonalAgentsStore.getState().agents.find((candidate) => candidate.id === id);
  return { id, name: agent?.name || "Agent" };
}

const changed = (instance: string) => {
  for (const listener of [...(listeners.get(instance) ?? [])]) listener();
};

export function noteAppAgent(instance: string, agent: AppAgent) {
  const known = byInstance.get(instance) ?? new Map<string, AppAgent>();
  const before = known.get(agent.id);
  if (before && before.name === agent.name) return;
  known.set(agent.id, agent);
  byInstance.set(instance, known);
  changed(instance);
}

export function appAgents(instance: string): AppAgent[] {
  return [...(byInstance.get(instance)?.values() ?? [])];
}

export function onAppAgents(instance: string, listener: () => void): () => void {
  const set = listeners.get(instance) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(instance, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(instance);
  };
}

export function forgetAppAgents(instance: string) {
  if (!byInstance.delete(instance)) return;
  changed(instance);
}
