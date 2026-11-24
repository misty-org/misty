import { registerSettingsSections, type SettingsSection } from "@/features/settings";

export const settingsSectionIds = [
  "general",
  "updates",
  "account",
  "status",
  "requests",
  "sessions",
  "notifications",
  "server",
  "drive",
  "menu-bar",
  "appearance",
  "fonts",
  "accessibility",
  "shortcuts",
  "voice",
  "devices",
  "privacy",
  "agent-activity",
  "advanced",
  "network",
  "performance",
  "diagnostics",
  "models",
  "agents-defaults",
  "agents-companion",
  "agents-permissions",
  "agents-computer-use",
  "pets",
  "bottom-bar",
  "search",
  "thumbnails",
  "apps-data",
  "agents-list",
  "engines-clis",
  "engines-channels",
  "engines-environment",
  "engines-usage",
] as const satisfies readonly SettingsSection[];

registerSettingsSections(settingsSectionIds, async () => {
  const { settingsSections } = await import("./settings_section_list");
  return settingsSections;
});
