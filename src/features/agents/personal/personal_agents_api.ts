import { readApiCache, writeApiCache } from "@/api/cache/api_cache";
import { invoke } from "@/native/invoke";
import { localDocuments } from "../conversations/state/local_chats";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { listEngines, mistyEngine, type EngineInfo } from "../engines/engines_api";
import { ENGINE_NAMES, type EngineId } from "@/features/engine-config/channels";
import { agentAccountId } from "./agent_account";
import { freshAgentName } from "./agent_names";
import { newAgentHomeSpace, placeUnplacedAgents } from "./agent_home_space";

const kind = "agent" as const;

const order = (a: AgentProfile, b: AgentProfile) =>
  Number(b.system_managed) - Number(a.system_managed) || a.created_at.localeCompare(b.created_at);

async function stored(account: string): Promise<AgentProfile[]> {
  const rows = await localDocuments.list(account, kind);
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row) as AgentProfile];
    } catch {
      return [];
    }
  });
}

async function write(account: string, agent: AgentProfile, expected: string | null) {
  return localDocuments.swap(account, kind, agent.id, expected, JSON.stringify(agent));
}

const offeredScope = (account: string) => `device:agent-engines-offered:${account || "local"}`;

interface Offered {
  revision: number;
  engines: string[];
}

async function offeredEngines(account: string): Promise<Offered> {
  const { revision, state } = await invoke<{
    revision: number;
    state: { engines?: unknown } | null;
  }>("settings_session_state", { scope: offeredScope(account) });
  const kept = Array.isArray(state?.engines) ? state.engines : [];
  return { revision, engines: kept.filter((id): id is string => typeof id === "string") };
}

const engineAgent = (
  account: string,
  engine: EngineInfo,
  now: string,
  name: string,
): AgentProfile => ({
  id: `personal_engine_${engine.id}`,
  owner_user_id: account,
  name,
  role: "Coding agent",
  description: "",
  instructions: "",
  icon: "",
  avatar: {},
  model_mode: "automatic",
  model_id: "",
  reasoning_effort: "",
  enabled: true,
  default_run_mode: "ask",
  engine: engine.id,
  system_managed: false,
  space_id: newAgentHomeSpace(account),
  version: 1,
  created_at: now,
  updated_at: now,
});

async function meetInstalledEngines(account: string, agents: AgentProfile[]) {
  const made: AgentProfile[] = [];
  let engines: EngineInfo[];
  try {
    engines = await listEngines();
  } catch {
    return made;
  }
  let known: Offered;
  try {
    known = await offeredEngines(account);
  } catch {
    return made;
  }
  const offered = new Set(known.engines);
  const fresh = engines.filter(
    (engine) => engine.installed && engine.id !== mistyEngine && !offered.has(engine.id),
  );
  if (!fresh.length) return made;
  for (const engine of fresh) offered.add(engine.id);
  try {
    await invoke("settings_session_commit", {
      scope: offeredScope(account),
      revision: known.revision,
      document: { engines: [...offered] },
    });
  } catch {
    return made;
  }
  const now = new Date().toISOString();
  const taken = agents.map((agent) => agent.name);
  for (const engine of fresh) {
    if (agents.some((agent) => agent.engine === engine.id)) continue;
    const name = freshAgentName(taken);
    taken.push(name);
    const agent = engineAgent(account, engine, now, name);
    if (await write(account, agent, null)) made.push(agent);
  }
  return made;
}

export let newEngineAgents: AgentProfile[] = [];

const otherKinds = [
  "conversation",
  "folder",
  "lesson",
  "course",
  "collaboration",
  "notebook",
  "run",
  "attachment",
  "artifact",
  "composer",
  "tutor_notebook",
  "tutor_deck",
  "tutor_guide",
  "tutor_job",
  "studio",
] as const;

async function moveChats(account: string, from: string, to: string) {
  for (const raw of await localDocuments.list(account, "conversation")) {
    let chat: { id?: string; agentId?: string };
    try {
      chat = JSON.parse(raw) as typeof chat;
    } catch {
      continue;
    }
    if (chat.agentId !== from || !chat.id) continue;
    await localDocuments.swap(
      account,
      "conversation",
      chat.id,
      raw,
      JSON.stringify({ ...chat, agentId: to }),
    );
  }
  const named = JSON.stringify(from);
  for (const other of otherKinds) {
    if ((await localDocuments.list(account, other)).some((raw) => raw.includes(named)))
      return false;
  }
  return true;
}

async function mergeTwins(account: string, agents: AgentProfile[]) {
  const gone = new Set<string>();
  for (const copy of agents) {
    if (!copy.engine || copy.id !== `personal_engine_${copy.engine}`) continue;
    const own = agents
      .filter(
        (agent) =>
          agent.id !== copy.id &&
          !agent.system_managed &&
          agent.engine === copy.engine &&
          agent.name.trim() === copy.name.trim(),
      )
      .sort(order)[0];
    if (!own || copy.instructions.trim()) continue;
    if (!(await moveChats(account, copy.id, own.id))) continue;
    await localDocuments.remove(account, kind, copy.id);
    gone.add(copy.id);
  }
  return agents.filter((agent) => !gone.has(agent.id));
}

const ownNamesScope = (account: string) => `device:agent-own-names:${account || "local"}`;

async function giveOwnNames(account: string, agents: AgentProfile[]) {
  let revision: number;
  try {
    const known = await invoke<{ revision: number; state: { done?: unknown } | null }>(
      "settings_session_state",
      { scope: ownNamesScope(account) },
    );
    if (known.state?.done === true) return agents;
    revision = known.revision;
  } catch {
    return agents;
  }
  try {
    await invoke("settings_session_commit", {
      scope: ownNamesScope(account),
      revision,
      document: { done: true },
    });
  } catch {
    return agents;
  }
  const engineNamed = (agent: AgentProfile) => {
    const engineName = agent.engine ? ENGINE_NAMES[agent.engine as EngineId] : undefined;
    return (
      !agent.system_managed &&
      Boolean(engineName) &&
      agent.name.trim().toLowerCase() === engineName?.toLowerCase()
    );
  };
  const taken = agents.filter((agent) => !engineNamed(agent)).map((agent) => agent.name);
  const renamed = new Map<string, AgentProfile>();
  for (const agent of agents.filter(engineNamed).sort(order)) {
    const raw = await localDocuments.get(account, kind, agent.id).catch(() => null);
    if (!raw) continue;
    const name = freshAgentName(taken);
    const next = { ...agent, name, version: agent.version + 1 };
    if (await write(account, next, raw).catch(() => false)) {
      taken.push(name);
      renamed.set(agent.id, next);
    }
  }
  return agents.map((agent) => renamed.get(agent.id) ?? agent);
}

export async function listPersonalAgents(account: string): Promise<AgentProfile[]> {
  const agents = await stored(account);
  newEngineAgents = await meetInstalledEngines(account, agents).catch(() => []);
  const all = [...agents, ...newEngineAgents];
  const twinless = await mergeTwins(account, all).catch(() => all);
  newEngineAgents = newEngineAgents.filter((agent) => twinless.includes(agent));
  const merged = await giveOwnNames(account, twinless).catch(() => twinless);
  const placed = await placeUnplacedAgents(account, merged).catch(() => merged);
  newEngineAgents = newEngineAgents.flatMap(
    (made) => placed.find((agent) => agent.id === made.id) ?? [],
  );
  return placed.sort(order);
}

export async function newAgentOn(
  account: string,
  engine: EngineInfo,
  name = "",
  id = `personal_${crypto.randomUUID()}`,
) {
  const now = new Date().toISOString();
  const given = name.trim().slice(0, 80);
  const agent: AgentProfile = {
    ...engineAgent(
      account,
      engine,
      now,
      given || freshAgentName((await stored(account)).map((agent) => agent.name)),
    ),
    id,
  };
  await write(account, agent, null);
  return agent;
}

class AgentConflict extends Error {
  constructor() {
    super("This agent changed since it was opened. Open it again and retry.");
  }
}

const savedAgentsKey = (account: string) => `agents/personal:${account}`;

async function savedAgents(account: string): Promise<AgentProfile[] | undefined> {
  const hit = await readApiCache("device", savedAgentsKey(account));
  if (!hit) return undefined;
  try {
    const agents = JSON.parse(hit.body) as unknown;
    return Array.isArray(agents) ? (agents as AgentProfile[]) : undefined;
  } catch {
    return undefined;
  }
}

export const personalAgentsApi = {
  list: async (onCached?: (value: { agents: AgentProfile[] }) => void) => {
    const account = agentAccountId();
    let answered = false;
    if (onCached && account) {
      void savedAgents(account).then((agents) => {
        if (agents && !answered) onCached({ agents });
      });
    }
    try {
      const agents = await listPersonalAgents(account);
      if (account) void writeApiCache("device", savedAgentsKey(account), JSON.stringify(agents));
      return { agents };
    } finally {
      answered = true;
    }
  },
  save: async (
    input: AgentProfileInput & { version?: number },
    id?: string,
  ): Promise<AgentProfile> => {
    const account = agentAccountId();
    const now = new Date().toISOString();
    const { version, ...profile } = input;
    if (!id) {
      const agent: AgentProfile = {
        ...profile,
        id: `personal_${crypto.randomUUID()}`,
        owner_user_id: account,
        system_managed: false,
        space_id: newAgentHomeSpace(account),
        version: 1,
        created_at: now,
        updated_at: now,
      };
      await write(account, agent, null);
      return agent;
    }
    const raw = await localDocuments.get(account, kind, id);
    if (!raw) throw new Error("This agent is gone.");
    const current = JSON.parse(raw) as AgentProfile;
    if (version !== undefined && version !== current.version) throw new AgentConflict();
    const next: AgentProfile = {
      ...current,
      ...profile,
      voice: profile.voice === undefined ? current.voice : profile.voice,
      ...(current.system_managed ? { name: current.name, enabled: true } : {}),
      space_id: current.space_id,
      version: current.version + 1,
      updated_at: now,
    };
    if (!(await write(account, next, raw))) throw new AgentConflict();
    return next;
  },
  remove: async (id: string) => {
    const account = agentAccountId();
    const raw = await localDocuments.get(account, kind, id);
    if (raw && (JSON.parse(raw) as AgentProfile).system_managed)
      throw new Error("Misty can't be removed.");
    await localDocuments.remove(account, kind, id);
  },
};
