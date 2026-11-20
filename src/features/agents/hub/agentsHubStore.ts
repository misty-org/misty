import { openSettings, type SettingsSection } from "@/features/settings";

/**
 * What was the Agents window: the person's agents and their engines are pages of Settings; Explore
 * holds the agent and app catalogs, plugins, skills, prompts and connectors.
 */
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

/** The Settings page each of the first ones is. */
export const agentsHubSections: Partial<Record<AgentsHubPage, SettingsSection>> = {
  agents: "agents-list",
  clis: "engines-clis",
  channels: "engines-channels",
  environment: "engines-environment",
  usage: "engines-usage",
};

/** The Explore page tab each catalog item opens. */
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

/** Opens Explore on one tab; the window's canvas opens it in the focused pane. */
export function openAgentsPage(tab = "agents") {
  window.dispatchEvent(new CustomEvent<{ tab: string }>(openAgentsPageEvent, { detail: { tab } }));
}

/** Opens one of the agents' pages: the person's agents when none is named. */
export function openAgentsHub(page: AgentsHubPage = "agents") {
  const tab = agentsHubTabs[page];
  if (tab) openAgentsPage(tab);
  else openSettings(agentsHubSections[page]);
}
