import type { PersonalAgent } from "@/models/interfaces/features/agents/personal";

export interface AgentSidebarItem {
  id: string;
  name: string;
  personalAgent?: PersonalAgent;
}
