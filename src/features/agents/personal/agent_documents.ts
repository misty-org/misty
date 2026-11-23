import type { AgentProfile } from "@/shared/schemas";
import { localDocuments } from "../conversations/state/local_chats";

const kind = "agent" as const;

const keptBeside = ["sitegrant_"];

export interface StoredAgent {
  agent: AgentProfile;
  raw: string;
}

export const agentOrder = (a: AgentProfile, b: AgentProfile) =>
  Number(b.system_managed) - Number(a.system_managed) || a.created_at.localeCompare(b.created_at);

function parsed(raw: string): AgentProfile | null {
  try {
    const value = JSON.parse(raw) as Partial<AgentProfile> | null;
    if (!value || typeof value.id !== "string" || typeof value.name !== "string") return null;
    if (keptBeside.some((prefix) => value.id!.startsWith(prefix))) return null;
    return value as AgentProfile;
  } catch {
    return null;
  }
}

export async function storedAgents(account: string): Promise<StoredAgent[]> {
  const rows = await localDocuments.list(account, kind);
  return rows.flatMap((raw) => {
    const agent = parsed(raw);
    return agent ? [{ agent, raw }] : [];
  });
}

export async function storedAgent(account: string, id: string): Promise<StoredAgent | null> {
  const raw = await localDocuments.get(account, kind, id);
  const agent = raw ? parsed(raw) : null;
  return raw && agent ? { agent, raw } : null;
}

export function writeAgent(account: string, agent: AgentProfile, expected: string | null) {
  return localDocuments.swap(account, kind, agent.id, expected, JSON.stringify(agent));
}

export function forgetAgent(account: string, id: string) {
  return localDocuments.remove(account, kind, id);
}

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

export async function moveAgentChats(account: string, from: string, to: string) {
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
