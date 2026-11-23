import { readApiCache, writeApiCache } from "@/api/cache/api_cache";
import { invoke } from "@/native/invoke";
import { spaceForNewItems } from "@/features/app-windows";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { listEngines, mistyEngine, type EngineInfo } from "../engines/engines_api";
import { ENGINE_NAMES, type EngineId } from "@/features/engine-config/channels";
import { agentAccountId } from "./agent_account";
import { freshAgentName } from "./agent_names";
import { newAgentHomeSpace, ownSpaceOf, placeUnplacedAgents } from "./agent_home_space";
import { definitionFields, sameDefinition } from "./agent_definition";
import {
  agentOrder as order,
  forgetAgent,
  moveAgentChats,
  storedAgent,
  storedAgents,
  writeAgent as write,
} from "./agent_documents";
import {
  publishAgent,
  removeSpaceAgent,
  saveAgentDefinition,
  spaceAgentConflicted,
  spaceAgentStatus,
  syncSpaceAgents,
} from "./space_agent_sync";

async function stored(account: string): Promise<AgentProfile[]> {
  return (await storedAgents(account)).map((item) => item.agent);
}

const ownLocal = (account: string, agent: AgentProfile) =>
  !agent.revision && (!agent.owner_user_id || agent.owner_user_id === account);

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
  revision: 0,
  can_edit: true,
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
    if (agents.some((agent) => agent.engine === engine.id && agent.owner_user_id === account))
      continue;
    const name = freshAgentName(taken);
    taken.push(name);
    const agent = engineAgent(account, engine, now, name);
    if (await write(account, agent, null)) made.push(agent);
  }
  return made;
}

export let newEngineAgents: AgentProfile[] = [];

async function mergeTwins(account: string, agents: AgentProfile[]) {
  const gone = new Set<string>();
  for (const copy of agents) {
    if (!copy.engine || copy.id !== `personal_engine_${copy.engine}` || !ownLocal(account, copy))
      continue;
    const own = agents
      .filter(
        (agent) =>
          agent.id !== copy.id &&
          ownLocal(account, agent) &&
          !agent.system_managed &&
          agent.engine === copy.engine &&
          agent.name.trim() === copy.name.trim(),
      )
      .sort(order)[0];
    if (!own || copy.instructions.trim()) continue;
    if (!(await moveAgentChats(account, copy.id, own.id))) continue;
    await forgetAgent(account, copy.id);
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
      ownLocal(account, agent) &&
      Boolean(engineName) &&
      agent.name.trim().toLowerCase() === engineName?.toLowerCase()
    );
  };
  const taken = agents.filter((agent) => !engineNamed(agent)).map((agent) => agent.name);
  const renamed = new Map<string, AgentProfile>();
  for (const agent of agents.filter(engineNamed).sort(order)) {
    const known = await storedAgent(account, agent.id).catch(() => null);
    if (!known) continue;
    const name = freshAgentName(taken);
    const next = { ...known.agent, name, version: known.agent.version + 1 };
    if (await write(account, next, known.raw).catch(() => false)) {
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

function newAgentSpace(account: string, spaceId?: string) {
  if (spaceId) return spaceId;
  const { spaceId: shown, personal } = spaceForNewItems();
  return (personal ? ownSpaceOf(account) : shown) || newAgentHomeSpace(account);
}

function gone(): Error {
  return new Error("This agent is gone.");
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
      const local = await listPersonalAgents(account);
      const synced = await syncSpaceAgents(account).catch(() => null);
      const agents = synced ?? local;
      if (account) void writeApiCache("device", savedAgentsKey(account), JSON.stringify(agents));
      return { agents };
    } finally {
      answered = true;
    }
  },
  save: async (
    input: AgentProfileInput & { version?: number },
    id?: string,
    options: { spaceId?: string } = {},
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
        space_id: newAgentSpace(account, options.spaceId),
        revision: 0,
        can_edit: true,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      await write(account, agent, null);
      try {
        return await publishAgent(account, { agent, raw: JSON.stringify(agent) }, undefined, true);
      } catch (error) {
        if (spaceAgentStatus(error) < 400) return agent;
        await forgetAgent(account, agent.id).catch(() => undefined);
        throw error;
      }
    }
    const known = await storedAgent(account, id);
    if (!known) throw gone();
    const current = known.agent;
    if (version !== undefined && version !== current.version) throw new AgentConflict();
    let next: AgentProfile = {
      ...current,
      ...profile,
      voice: profile.voice === undefined ? current.voice : profile.voice,
      ...(current.system_managed ? { name: current.name, enabled: true } : {}),
      ...(current.can_edit === false ? definitionFields(current) : {}),
      space_id: current.space_id,
      revision: current.revision,
      can_edit: current.can_edit,
      version: current.version + 1,
      updated_at: now,
    };
    if (current.revision && current.can_edit !== false && !sameDefinition(current, next)) {
      try {
        next = {
          ...(await saveAgentDefinition(next, current.revision)),
          version: next.version,
        };
      } catch (error) {
        if (spaceAgentConflicted(error)) throw new AgentConflict();
        if (spaceAgentStatus(error) === 404) throw gone();
        throw error;
      }
    }
    if (!(await write(account, next, known.raw))) {
      const latest = await storedAgent(account, id);
      if (!latest || !current.revision || !(await write(account, next, latest.raw)))
        throw new AgentConflict();
    }
    if (!next.revision)
      return publishAgent(account, { agent: next, raw: JSON.stringify(next) }).catch(() => next);
    return next;
  },
  remove: async (id: string) => {
    const account = agentAccountId();
    const known = await storedAgent(account, id);
    if (known?.agent.system_managed) throw new Error("Misty can't be removed.");
    if (known?.agent.revision) {
      if (known.agent.can_edit === false)
        throw new Error("Only its maker, the Space's owner or a moderator can delete this agent.");
      await removeSpaceAgent(known.agent);
    }
    await forgetAgent(account, id);
  },
};
