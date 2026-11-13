import {
  Cpu,
  EyeOff,
  Keyboard,
  MessagesSquare,
  Mic,
  MousePointer2,
  Palette,
  Plug,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  UserCircle,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
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
  | "shortcuts"
  | "voice"
  | "privacy"
  | "advanced"
  | "models"
  | "conversations"
  | "tutor"
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
  models: { label: "Models", icon: Cpu },
  conversations: { label: "Behavior", icon: MessagesSquare },
  tutor: { label: "Tutor", icon: MousePointer2 },
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
    areas: ["models", "engines", "tools", "conversations", "tutor", "access"],
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
  block("general", "updates", "Updates"),
  block("account", "account", "Profile", "resource"),
  block("server", "server", "Server"),
  block("appearance", "appearance", "Appearance"),
  block("appearance", "fonts", "Fonts"),
  block("appearance", "pets", "Pet"),
  block("appearance", "bottom-bar", "Bottom bar"),
  block("shortcuts", "shortcuts", "Shortcuts"),
  block("voice", "voice", "Voice"),
  block("privacy", "privacy", "Privacy"),
  block("privacy", "agent-activity", "Agent activity"),
  block("advanced", "advanced", "Advanced"),
  block("advanced", "network", "Network"),
  block("advanced", "performance", "Performance"),
  block("models", "models", "Models"),
  block("engines", "engine-clis", "CLIs"),
  block("engines", "engine-channels", "Channels"),
  block("engines", "engine-env", "Environment variables"),
  block("engines", "engine-usage", "Usage"),
  block("tools", "engine-mcp", "MCP servers"),
  block("tools", "engine-skills", "Skills"),
  block("tools", "engine-prompts", "Prompts"),
  block("conversations", "agents-defaults", "Conversations"),
  block("conversations", "agents-personas", "Personas"),
  block("tutor", "agents-companion", "Tutor"),
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
