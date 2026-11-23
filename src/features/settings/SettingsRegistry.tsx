import {
  Keyboard,
  LayoutGrid,
  Palette,
  Search,
  Server,
  SlidersHorizontal,
  UserCircle,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { spaceIcons } from "@misty/ui";
import type { SettingOwnership } from "./device-preferences/registry";
import type { SettingsContentProps, SettingsSection } from "./settings_types";

export { preferenceSection, preferencesWithoutRows } from "./settings_routing";

type SettingsArea =
  | "account"
  | "general"
  | "server"
  | "appearance"
  | "input"
  | "advanced"
  | "search"
  | "files"
  | "apps"
  | "agents";

interface SettingsAreaInfo {
  label: string;
  icon: LucideIcon;
}

export const settingsAreas: Record<SettingsArea, SettingsAreaInfo> = {
  account: { label: "Profile", icon: UserCircle },
  general: { label: "General", icon: SlidersHorizontal },
  server: { label: "Server", icon: Server },
  appearance: { label: "Interface", icon: Palette },
  input: { label: "Input", icon: Keyboard },
  advanced: { label: "Advanced", icon: Wrench },
  search: { label: "Search", icon: Search },
  files: { label: "Files", icon: spaceIcons.files },
  apps: { label: "Apps", icon: LayoutGrid },
  agents: { label: "Agents", icon: Users },
};

export const settingsGroups: readonly { label: string; areas: readonly SettingsArea[] }[] = [
  { label: "Account", areas: ["account", "server"] },
  {
    label: "App",
    areas: ["general", "appearance", "input", "advanced"],
  },
  { label: "Pages", areas: ["search", "files", "apps", "agents"] },
];

interface SettingsBlock {
  id: SettingsSection;
  label: string;
  area: SettingsArea;
  owner: SettingOwnership;
}

interface SettingsRegistryEntry extends SettingsBlock {
  Component: ComponentType<SettingsContentProps>;
}

const block = (
  area: SettingsArea,
  id: SettingsSection,
  label: string,
  owner: SettingOwnership = "device",
): SettingsBlock => ({ area, id, label, owner });

const settingsBlocks: readonly SettingsBlock[] = [
  block("general", "general", "Startup"),
  block("general", "updates", "Updates"),
  block("account", "account", "Profile", "resource"),
  block("account", "status", "Status", "resource"),
  block("account", "requests", "Requests", "resource"),
  block("account", "notifications", "Notifications"),
  block("server", "server", "Server"),
  block("server", "drive", "Drive"),
  block("server", "menu-bar", "Menu bar"),
  block("server", "privacy", "Data"),
  block("appearance", "appearance", "Appearance"),
  block("appearance", "fonts", "Fonts"),
  block("appearance", "pets", "Pet"),
  block("appearance", "bottom-bar", "Bottom bar"),
  block("appearance", "accessibility", "Accessibility"),
  block("input", "shortcuts", "Shortcuts"),
  block("input", "voice", "Voice"),
  block("input", "devices", "Devices"),
  block("advanced", "advanced", "Advanced"),
  block("advanced", "network", "Network"),
  block("advanced", "performance", "Performance"),
  block("advanced", "diagnostics", "Diagnostics"),
  block("search", "search", "Sources"),
  block("files", "thumbnails", "Thumbnails"),
  block("apps", "apps-data", "Data"),
  block("agents", "agents-list", "Team", "resource"),
  block("agents", "agents-defaults", "Conversations"),
  block("agents", "agents-companion", "Tutor"),
  block("agents", "agents-permissions", "Access", "resource"),
  block("agents", "agents-computer-use", "Computer use"),
  block("agents", "agent-activity", "Activity"),
  block("agents", "models", "Engine"),
  block("agents", "engines-clis", "Setup", "resource"),
  block("agents", "engines-channels", "Channels", "resource"),
  block("agents", "engines-environment", "Environment", "resource"),
  block("agents", "engines-usage", "Usage", "resource"),
];

export const settingsRegistry: SettingsRegistryEntry[] = [];

export function registerSettingsSections(
  components: Partial<Record<SettingsSection, ComponentType<SettingsContentProps>>>,
): void {
  settingsRegistry.length = 0;
  for (const entry of settingsBlocks) {
    const Component = components[entry.id];
    if (Component) settingsRegistry.push({ ...entry, Component });
  }
}

export function settingsPage(section: SettingsSection): SettingsRegistryEntry | undefined {
  return settingsRegistry.find((entry) => entry.id === section);
}

export function settingsPageTitle(entry: SettingsRegistryEntry): string {
  return settingsAreas[entry.area].label;
}

export function settingsAreaEntry(area: SettingsArea): SettingsRegistryEntry | undefined {
  return settingsRegistry.find((entry) => entry.area === area);
}
