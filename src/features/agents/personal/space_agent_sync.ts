import { ApiRequestError } from "@/api/client";
import { invoke } from "@/native/invoke";
import type { AgentProfile } from "@/shared/schemas";
import { spaceAgentsApi, type SpaceAgent } from "../api/space_agents";
import { agentAccountId, isSignedIn } from "./agent_account";
import { ownSpaceOf } from "./agent_home_space";
import { definitionOf, differsFromSpace, fromSpace, withSpace } from "./agent_definition";
import {
  agentOrder,
  forgetAgent,
  moveAgentChats,
  storedAgent,
  storedAgents,
  writeAgent,
  type StoredAgent,
} from "./agent_documents";

const listedAtMost = 2000;

const statusOf = (error: unknown) => (error instanceof ApiRequestError ? error.status : 0);

const conflicted = (error: unknown) =>
  error instanceof ApiRequestError && error.status === 409 && error.code === "version_conflict";

const sharedEngineId = (id: string) => id.startsWith("personal_engine_");

const freshAgentId = () => `agent_${crypto.randomUUID()}`;

function knownById(listed: SpaceAgent[], personal: string, account: string) {
  const rank = (agent: SpaceAgent) =>
    (agent.space_id === personal ? 2 : 0) + (agent.owner_user_id === account ? 1 : 0);
  const byId = new Map<string, SpaceAgent>();
  for (const agent of listed) {
    if (!agent.revision) continue;
    const known = byId.get(agent.agent_id);
    if (!known || rank(agent) > rank(known)) byId.set(agent.agent_id, agent);
  }
  return byId;
}

async function adopt(account: string, stored: StoredAgent, server: SpaceAgent) {
  const next = {
    ...withSpace(stored.agent, server),
    version: stored.agent.version + 1,
  };
  return (await writeAgent(account, next, stored.raw).catch(() => false)) ? next : stored.agent;
}

async function rekey(
  account: string,
  stored: StoredAgent,
  id = freshAgentId(),
): Promise<StoredAgent | null> {
  const next: AgentProfile = { ...stored.agent, id, version: 1 };
  if (!(await writeAgent(account, next, null).catch(() => false))) {
    const there = await storedAgent(account, id).catch(() => null);
    if (!there) return null;
    await moveAgentChats(account, stored.agent.id, id).catch(() => false);
    await forgetAgent(account, stored.agent.id).catch(() => undefined);
    return there;
  }
  await moveAgentChats(account, stored.agent.id, next.id).catch(() => false);
  await forgetAgent(account, stored.agent.id).catch(() => undefined);
  const raw = JSON.stringify(next);
  return { agent: next, raw };
}

async function copyIdFor(account: string, agentId: string, spaceId: string) {
  const bytes = new TextEncoder().encode(`${account}\u0000${agentId}\u0000${spaceId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0"));
  return `agent_${hex.join("")}`;
}

export async function publishAgent(
  account: string,
  stored: StoredAgent,
  listed?: SpaceAgent[],
  strict = false,
): Promise<AgentProfile> {
  const personal = ownSpaceOf(account);
  if (!isSignedIn() || stored.agent.system_managed || stored.agent.revision) return stored.agent;
  let current = stored;
  let spaceId = current.agent.space_id || personal;
  if (!spaceId) return current.agent;
  let oldListing = "";
  if (sharedEngineId(current.agent.id) && spaceId !== personal) {
    const there = (
      listed ?? (await spaceAgentsApi.list(spaceId).catch(() => ({ agents: [] }))).agents
    ).find((agent) => agent.space_id === spaceId && agent.agent_id === current.agent.id);
    if (there && !there.revision && there.owner_user_id === account) oldListing = there.agent_id;
    const moved = await rekey(account, current, await copyIdFor(account, current.agent.id, spaceId));
    if (!moved) return current.agent;
    current = moved;
  }
  const oldListingSpace = spaceId;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const saved = await spaceAgentsApi.put(spaceId, current.agent.id, {
        ...definitionOf(current.agent),
        revision: 0,
      });
      if (oldListing)
        await spaceAgentsApi.remove(oldListingSpace, oldListing).catch(() => undefined);
      return adopt(account, current, saved);
    } catch (error) {
      const status = statusOf(error);
      if (conflicted(error)) {
        const fresh = await spaceAgentsApi.list(spaceId).catch(() => null);
        if (!fresh) return current.agent;
        const there = fresh.agents.find(
          (agent) => agent.space_id === spaceId && agent.agent_id === current.agent.id,
        );
        if (there && there.revision && there.owner_user_id === account)
          return adopt(account, current, there);
        const moved = await rekey(account, current);
        if (!moved) return current.agent;
        current = moved;
        continue;
      }
      if ((status === 403 || status === 404) && personal && spaceId !== personal) {
        spaceId = personal;
        continue;
      }
      if (strict && status >= 400 && status < 500) throw error;
      return current.agent;
    }
  }
  return current.agent;
}

const listingsScope = (account: string) => `device:agent-listings-moved:${account}`;

async function moveOldListings(
  account: string,
  listed: SpaceAgent[],
  agents: Map<string, AgentProfile>,
  homes: Map<string, string>,
) {
  let revision: number;
  try {
    const known = await invoke<{ revision: number; state: { done?: unknown } | null }>(
      "settings_session_state",
      { scope: listingsScope(account) },
    );
    if (known.state?.done === true) return;
    revision = known.revision;
  } catch {
    return;
  }
  const personal = ownSpaceOf(account);
  const old = listed.filter(
    (agent) =>
      !agent.revision &&
      agent.owner_user_id === account &&
      homes.get(agent.agent_id) !== agent.space_id,
  );
  let settled = true;
  for (const listing of old) {
    const agent = agents.get(listing.agent_id);
    if (!agent) continue;
    try {
      if (listing.space_id !== personal) {
        const id = await copyIdFor(account, listing.agent_id, listing.space_id);
        const copy = await spaceAgentsApi
          .put(listing.space_id, id, { ...definitionOf(agent), revision: 0 })
          .catch((error: unknown) => {
            if (!conflicted(error)) throw error;
            return null;
          });
        if (copy) await writeAgent(account, fromSpace(copy), null).catch(() => false);
      }
      await spaceAgentsApi.remove(listing.space_id, listing.agent_id).catch((error: unknown) => {
        if (statusOf(error) !== 404) throw error;
      });
    } catch {
      settled = false;
    }
  }
  if (!settled) return;
  await invoke("settings_session_commit", {
    scope: listingsScope(account),
    revision,
    document: { done: true },
  }).catch(() => undefined);
}

async function reconcile(
  account: string,
  listed: SpaceAgent[],
  complete: boolean,
  inSpace?: string,
): Promise<AgentProfile[]> {
  const personal = ownSpaceOf(account);
  const byId = knownById(listed, personal, account);
  const local = await storedAgents(account);
  const homes = new Map<string, string>();
  const known = new Map<string, AgentProfile>();
  for (const stored of local) {
    const { agent } = stored;
    if (agent.system_managed) continue;
    homes.set(agent.id, agent.space_id || personal);
    known.set(agent.id, agent);
    if (!agent.revision) {
      if (inSpace) continue;
      await publishAgent(account, stored, listed);
      continue;
    }
    if (inSpace && agent.space_id !== inSpace) continue;
    const server = byId.get(agent.id);
    byId.delete(agent.id);
    if (server) {
      if (differsFromSpace(agent, server)) await adopt(account, stored, server);
      continue;
    }
    if (complete) await forgetAgent(account, agent.id).catch(() => undefined);
  }
  const ours = new Set(local.map((stored) => stored.agent.id));
  for (const server of byId.values()) {
    if (inSpace && server.space_id !== inSpace) continue;
    if (ours.has(server.agent_id)) continue;
    await writeAgent(account, fromSpace(server), null).catch(() => false);
  }
  if (!inSpace) await moveOldListings(account, listed, known, homes);
  return (await storedAgents(account)).map((stored) => stored.agent).sort(agentOrder);
}

const syncing = new Map<string, Promise<AgentProfile[] | null>>();

function ready(account: string) {
  return (
    Boolean(account) &&
    isSignedIn() &&
    account === agentAccountId() &&
    Boolean(ownSpaceOf(account))
  );
}

export function syncSpaceAgents(account: string): Promise<AgentProfile[] | null> {
  const running = syncing.get(account);
  if (running) return running;
  const work = (async () => {
    if (!ready(account)) return null;
    let listed: SpaceAgent[];
    try {
      listed = (await spaceAgentsApi.mine()).agents;
    } catch {
      return null;
    }
    return reconcile(account, listed, listed.length < listedAtMost);
  })().finally(() => syncing.delete(account));
  syncing.set(account, work);
  return work;
}

const refreshing = new Map<string, { again: boolean; work: Promise<AgentProfile[] | null> }>();

export function refreshSpaceAgents(account: string, spaceId: string): Promise<AgentProfile[] | null> {
  const key = `${account}\u0000${spaceId}`;
  const running = refreshing.get(key);
  if (running) {
    running.again = true;
    return running.work;
  }
  const entry = { again: false, work: Promise.resolve<AgentProfile[] | null>(null) };
  entry.work = (async () => {
    let result: AgentProfile[] | null = null;
    do {
      entry.again = false;
      if (!ready(account)) return null;
      let listed: SpaceAgent[];
      try {
        listed = (await spaceAgentsApi.list(spaceId)).agents;
      } catch (error) {
        if (statusOf(error) !== 403 && statusOf(error) !== 404) return result;
        listed = [];
      }
      result = await reconcile(account, listed, listed.length < listedAtMost, spaceId);
    } while (entry.again);
    return result;
  })().finally(() => refreshing.delete(key));
  refreshing.set(key, entry);
  return entry.work;
}

export async function copyAgentToSpace(agent: AgentProfile, spaceId: string): Promise<AgentProfile> {
  const account = agentAccountId();
  const saved = await spaceAgentsApi.put(spaceId, freshAgentId(), {
    ...definitionOf(agent),
    revision: 0,
  });
  const copy = fromSpace(saved);
  await writeAgent(account, copy, null);
  return copy;
}

export async function saveAgentDefinition(
  agent: AgentProfile,
  revision: number,
): Promise<AgentProfile> {
  const saved = await spaceAgentsApi.put(agent.space_id, agent.id, {
    ...definitionOf(agent),
    revision,
  });
  return withSpace(agent, saved);
}

export async function removeSpaceAgent(agent: AgentProfile) {
  if (!agent.revision) return;
  await spaceAgentsApi.remove(agent.space_id, agent.id).catch((error: unknown) => {
    if (statusOf(error) !== 404) throw error;
  });
}

export { conflicted as spaceAgentConflicted, statusOf as spaceAgentStatus };
