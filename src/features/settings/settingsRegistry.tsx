import {
  EyeOff,
  Keyboard,
  MessagesSquare,
  Mic,
  Palette,
  Plug,
  Server,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  SquareTerminal,
  UserCircle,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { SettingOwnership } from "./device-preferences/registry";
import { canonicalSettingsSection } from "./settingsRouting";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";

export {
  canonicalSettingsSection,
  preferenceSection,
  preferencesWithoutRows,
} from "./settingsRouting";

/**
 * Sidebar pages. Each opens one scrolling page; the registry blocks of a page render on it in
 * order. Page names are one word that never echoes its group's name.
 */
type SettingsArea =
  | "account"
  | "general"
  | "server"
  | "appearance"
  | "shortcuts"
  | "voice"
  | "privacy"
  | "advanced"
  | "models"
  | "conversations"
  | "access"
  | "engines"
  | "tools";

interface SettingsAreaInfo {
  label: string;
  icon: LucideIcon;
}

export const settingsAreas: Record<SettingsArea, SettingsAreaInfo> = {
  account: { label: "Profile", icon: UserCircle },
  general: { label: "General", icon: SlidersHorizontal },
  server: { label: "Server", icon: Server },
  appearance: { label: "Interface", icon: Palette },
  shortcuts: { label: "Shortcuts", icon: Keyboard },
  voice: { label: "Voice", icon: Mic },
  privacy: { label: "Privacy", icon: EyeOff },
  advanced: { label: "Advanced", icon: Wrench },
  models: { label: "Models", icon: Sparkles },
  conversations: { label: "Behavior", icon: MessagesSquare },
  access: { label: "Access", icon: ShieldCheck },
  engines: { label: "Engines", icon: SquareTerminal },
  tools: { label: "Tools", icon: Plug },
};

/** Sidebar groups, named by feature, in sidebar order. */
export const settingsGroups: readonly { label: string; areas: readonly SettingsArea[] }[] = [
  { label: "Account", areas: ["account", "server"] },
  {
    label: "App",
    areas: ["general", "appearance", "shortcuts", "voice", "privacy", "advanced"],
  },
  {
    label: "Agents",
    areas: ["models", "engines", "tools", "conversations", "access"],
  },
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
  block("general", "browser-tabs", "Agent pages"),
  block("general", "browser-downloads", "Downloads"),
  block("general", "updates", "Updates"),
  block("account", "account", "Profile", "resource"),
  block("server", "server", "Server"),
  block("appearance", "appearance", "Appearance"),
  block("appearance", "fonts", "Fonts"),
  block("appearance", "pets", "Pet"),
  block("shortcuts", "shortcuts", "Shortcuts"),
  block("voice", "voice", "Voice"),
  block("privacy", "privacy", "Privacy"),
  block("privacy", "browser-permissions", "Websites", "resource"),
  block("privacy", "agent-activity", "Agent activity"),
  block("advanced", "advanced", "Advanced"),
  block("advanced", "network", "Network"),
  block("advanced", "performance", "Performance"),
  block("models", "models", "Models"),
  block("engines", "engine-clis", "CLIs"),
  block("engines", "engine-channels", "Channels"),
  block("engines", "engine-usage", "Usage"),
  block("tools", "engine-mcp", "MCP servers"),
  block("tools", "engine-skills", "Skills"),
  block("tools", "engine-prompts", "Prompts"),
  block("conversations", "agents-defaults", "Conversations"),
  block("conversations", "misty", "Misty", "resource"),
  block("conversations", "agents-companion", "Cursor"),
  block("conversations", "agents-personas", "Personas"),
  block("access", "agents-permissions", "Access", "resource"),
  block("access", "agents-computer-use", "Computer use"),
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
  const id = canonicalSettingsSection(section);
  return settingsRegistry.find((entry) => entry.id === id);
}

/** The sidebar name of the page a block sits on. */
export function settingsPageTitle(entry: SettingsRegistryEntry): string {
  return settingsAreas[entry.area].label;
}

/** The first block of a page, which the sidebar entry opens. */
export function settingsAreaEntry(area: SettingsArea): SettingsRegistryEntry | undefined {
  return settingsRegistry.find((entry) => entry.area === area);
}
