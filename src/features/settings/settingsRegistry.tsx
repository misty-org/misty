import {
  CodeXml,
  Keyboard,
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
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";

export { preferenceSection, preferencesWithoutRows } from "./settingsRouting";

/**
 * Sidebar pages. Each opens one scrolling page; the registry blocks of a page render on it in
 * order. Page names are one word that never echoes its group's name.
 */
type SettingsArea =
  | "account"
  | "general"
  | "server"
  | "appearance"
  | "input"
  | "advanced"
  | "search"
  | "files"
  | "code"
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
  code: { label: "Code", icon: CodeXml },
  agents: { label: "Agents", icon: Users },
};

/**
 * Sidebar groups, named by feature, in sidebar order. Pages holds one page for each of the app's
 * places, with that place's name and icon, so what each can adjust is easy to find. Agents is one
 * page holding the person's team, behavior, tutor and access, then the engines' own setup,
 * channels, environment and usage. Pages hold many sections rather than there being many pages.
 */
export const settingsGroups: readonly { label: string; areas: readonly SettingsArea[] }[] = [
  { label: "Account", areas: ["account", "server"] },
  {
    label: "App",
    areas: ["general", "appearance", "input", "advanced"],
  },
  { label: "Pages", areas: ["search", "files", "code", "agents"] },
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

/** The blocks of each page, in page order; blocks of one page are adjacent. */
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
  block("code", "editor", "Editor"),
  block("code", "collaboration", "Collaboration"),
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

/**
 * The blocks that have a component, in page order. Each feature owns the component of its
 * blocks; the app hands them over once at startup with `registerSettingsSections`, so settings
 * never imports a feature.
 */
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

/** The sidebar name of the page a block sits on. */
export function settingsPageTitle(entry: SettingsRegistryEntry): string {
  return settingsAreas[entry.area].label;
}

/** The first block of a page, which the sidebar entry opens. */
export function settingsAreaEntry(area: SettingsArea): SettingsRegistryEntry | undefined {
  return settingsRegistry.find((entry) => entry.area === area);
}
