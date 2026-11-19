import type { ChatSection } from "@/features/agents";
import type { AgentProfile } from "@/shared/schemas";

export interface SidebarChat {
  id: string;
  title: string;
  updatedAt: string;
  agentId?: string;
  folderId?: string;
  pinnedAt?: string;
  archivedAt?: string;
  markedUnread?: boolean;
  lastReadAt?: string;
}

export interface Group {
  id: string;
  name: string;
  chats: SidebarChat[];
  section?: ChatSection;
  collapsible?: boolean;
  /** The agent every chat in it is with: its heading names the agent, so rows drop its mark. */
  agent?: AgentProfile;
}

/** Whether a group's chats are on screen: Archived opens on demand, an agent's folds away. */
export function groupOpen(group: Group, archivedOpen: boolean, collapsedAgents: readonly string[]) {
  if (group.agent) return !collapsedAgents.includes(group.agent.id);
  return !group.collapsible || archivedOpen;
}

/**
 * The sidebar's chat groups in order: pinned, each section the person made, one per agent (the
 * agent with the latest chat first), Chats for those whose agent is gone, and Archived last.
 */
export function sidebarChatGroups(
  chats: SidebarChat[],
  sections: readonly ChatSection[],
  agentOf: (agentId?: string) => AgentProfile | undefined,
): Group[] {
  const live = chats.filter((chat) => !chat.archivedAt);
  const filed = new Set(sections.map((section) => section.id));
  const list: Group[] = [];
  const pinned = live.filter((chat) => chat.pinnedAt);
  if (pinned.length) list.push({ id: "pinned", name: "Pinned", chats: pinned });
  for (const section of sections) {
    const held = live.filter((chat) => !chat.pinnedAt && chat.folderId === section.id);
    if (held.length) list.push({ id: section.id, name: section.name, chats: held, section });
  }
  const rest = live.filter(
    (chat) => !chat.pinnedAt && !(chat.folderId && filed.has(chat.folderId)),
  );
  // One group per agent, in the order their chats come (latest first); chats whose agent is
  // gone stay together under Chats at the end.
  const byAgent = new Map<string, { agent?: AgentProfile; chats: SidebarChat[] }>();
  for (const chat of rest) {
    const agent = agentOf(chat.agentId);
    const key = agent?.id ?? "";
    const held = byAgent.get(key) ?? { agent, chats: [] };
    held.chats.push(chat);
    byAgent.set(key, held);
  }
  const unknown = byAgent.get("");
  byAgent.delete("");
  for (const [id, held] of byAgent)
    list.push({
      id: `agent:${id}`,
      name: held.agent!.name,
      chats: held.chats,
      agent: held.agent,
    });
  if (unknown || !list.length)
    list.push({ id: "chats", name: "Chats", chats: unknown?.chats ?? [] });
  const archived = chats.filter((chat) => chat.archivedAt);
  if (archived.length)
    list.push({ id: "archived", name: "Archived", chats: archived, collapsible: true });
  return list;
}
