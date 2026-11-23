export interface SidebarChat {
  id: string;
  title: string;
  updatedAt: string;
  agentId?: string;
  archivedAt?: string;
  markedUnread?: boolean;
  lastReadAt?: string;
}
