import { openSettings, type SettingsSection } from "@/features/settings";
import { openExploreEvent, requestOpenExplore } from "@/shared/lib/open_explore";

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
  personas: "templates",
  plugins: "plugins",
  mcp: "mcps",
  skills: "skills",
  apps: "apps",
  connections: "mcps",
};

export const openAgentsPageEvent = openExploreEvent;

export function openAgentsPage(tab = "agents") {
  requestOpenExplore(tab);
}

export function openAgentsHub(page: AgentsHubPage = "agents") {
  const tab = agentsHubTabs[page];
  if (tab) openAgentsPage(tab);
  else openSettings(agentsHubSections[page]);
}
