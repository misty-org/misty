/** The conversation fields the agent-thread sidebar needs to choose each agent's latest chat. */
export interface SidebarChat {
  id: string;
  title: string;
  updatedAt: string;
  agentId?: string;
  archivedAt?: string;
  markedUnread?: boolean;
  lastReadAt?: string;
}
