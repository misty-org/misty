import { openSettings, type SettingsSection } from "@/features/settings";

export type AgentsHubPage =
  | "agents"
  | "personas"
  | "clis"
  | "channels"
  | "environment"
  | "usage"
  | "plugins"
  | "mcp"
  | "skills"
  | "prompts"
  | "apps"
  | "connections";

export const agentsHubSections: Partial<Record<AgentsHubPage, SettingsSection>> = {
  agents: "agents-list",
  clis: "engines-clis",
  channels: "engines-channels",
  environment: "engines-environment",
  usage: "engines-usage",
};

export const agentsHubTabs: Partial<Record<AgentsHubPage, string>> = {
  personas: "agents",
  plugins: "plugins",
  mcp: "mcp",
  skills: "skills",
  prompts: "prompts",
  apps: "apps",
  connections: "connections",
};

export const openAgentsPageEvent = "misty:open-agents-page";

export function openAgentsPage(tab = "agents") {
  window.dispatchEvent(new CustomEvent<{ tab: string }>(openAgentsPageEvent, { detail: { tab } }));
}

export function openAgentsHub(page: AgentsHubPage = "agents") {
  const tab = agentsHubTabs[page];
  if (tab) openAgentsPage(tab);
  else openSettings(agentsHubSections[page]);
}
