import { invoke } from "@/native/invoke";
import { agentAccountId } from "../personal/agentAccount";
import { localDocuments } from "../conversations/state/localChats";
import type { AgentGrant } from "./api";

/**
 * "Accept and remember" on a page step: this agent may send, delete or publish on this site in Auto.
 * Kept in misty.db on this computer. Payments are never remembered.
 */

const kind = "agent" as const;
const idPrefix = "sitegrant_";
const actions: Record<string, string> = {
  send: "browser.send",
  delete: "browser.delete",
  publish: "browser.publish",
};

const agentName = (id: string, names: Map<string, string>) => names.get(id) ?? "";

async function rows(): Promise<AgentGrant[]> {
  const stored = await localDocuments.list(agentAccountId(), kind);
  return stored.flatMap((row) => {
    try {
      const value = JSON.parse(row) as AgentGrant;
      return value.id?.startsWith(idPrefix) ? [value] : [];
    } catch {
      return [];
    }
  });
}

export const localSiteGrants = rows;

export async function rememberSiteGrant(input: { agentId: string; kind: string; origin: string }) {
  const action = actions[input.kind];
  if (!action) return;
  const id = `${idPrefix}${input.agentId}:${input.kind}:${input.origin}`;
  const grant: AgentGrant = {
    id,
    agent_id: input.agentId,
    agent_name: "",
    action,
    scope_kind: "origin",
    scope_id: input.origin,
    label: `${input.kind[0]!.toUpperCase()}${input.kind.slice(1)} on ${input.origin}`,
    created_at: new Date().toISOString(),
    use_count: 0,
  };
  await invoke("agent_chats_put", {
    account: agentAccountId(),
    kind,
    id,
    document: JSON.stringify(grant),
  });
}

export const revokeSiteGrant = (id: string) => localDocuments.remove(agentAccountId(), kind, id);

export async function revokeAgentSiteGrants(agentId: string) {
  const grants = await rows();
  await Promise.all(
    grants.filter((grant) => grant.agent_id === agentId).map((grant) => revokeSiteGrant(grant.id)),
  );
}

/** The grants with their agents' names, which can change after a grant is made. */
export function namedGrants(grants: AgentGrant[], names: Map<string, string>) {
  return grants.map((grant) => ({
    ...grant,
    agent_name: agentName(grant.agent_id, names) || grant.agent_name,
  }));
}
