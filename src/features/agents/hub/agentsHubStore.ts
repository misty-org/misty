import { openSettings, type SettingsSection } from "@/features/settings";

/**
 * What was the Agents window, now pages of Settings: the person's agents and the personas they can
 * start from, their engines, then what those engines can use: plugins, skills, prompts, MCP
 * servers and apps.
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
  | "apps";

/** The Settings page each of those is now. */
export const agentsHubSections: Record<AgentsHubPage, SettingsSection> = {
  agents: "agents-list",
  personas: "agents-personas",
  clis: "engines-clis",
  channels: "engines-channels",
  environment: "engines-environment",
  usage: "engines-usage",
  plugins: "tools-plugins",
  mcp: "tools-mcp",
  skills: "tools-skills",
  prompts: "tools-prompts",
  apps: "tools-apps",
};

/** Opens Settings on one of the agents' pages: the person's agents when none is named. */
export function openAgentsHub(page: AgentsHubPage = "agents") {
  openSettings(agentsHubSections[page]);
}
