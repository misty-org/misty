import {
  Blocks,
  Cable,
  ChartColumn,
  CodeXml,
  Cpu,
  EyeOff,
  FileText,
  Keyboard,
  MessagesSquare,
  Mic,
  MousePointer2,
  Palette,
  Plug,
  Route,
  ScrollText,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  UserCircle,
  UserRound,
  Users,
  Variable,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { spaceIcons } from "@/shared/ui";
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
  | "search"
  | "space"
  | "code"
  | "agents"
  | "personas"
  | "models"
  | "conversations"
  | "tutor"
  | "access"
  | "clis"
  | "channels"
  | "environment"
  | "usage"
  | "plugins"
  | "skills"
  | "prompts"
  | "mcp"
  | "apps";

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
  search: { label: "Search", icon: Search },
  space: { label: "Space", icon: spaceIcons.space },
  code: { label: "Code", icon: CodeXml },
  agents: { label: "Team", icon: Users },
  personas: { label: "Personas", icon: UserRound },
  models: { label: "Engine", icon: Cpu },
  conversations: { label: "Behavior", icon: MessagesSquare },
  tutor: { label: "Tutor", icon: MousePointer2 },
  access: { label: "Access", icon: ShieldCheck },
  clis: { label: "Setup", icon: SquareTerminal },
  channels: { label: "Channels", icon: Route },
  environment: { label: "Environment", icon: Variable },
  usage: { label: "Usage", icon: ChartColumn },
  plugins: { label: "Plugins", icon: Blocks },
  skills: { label: "Skills", icon: ScrollText },
  prompts: { label: "Prompts", icon: FileText },
  mcp: { label: "Connectors", icon: Cable },
  apps: { label: "Apps", icon: Plug },
};

/**
 * Sidebar groups, named by feature, in sidebar order. Pages holds one page for each of the app's
 * places, with that place's name and icon, so what each can adjust is easy to find. Agents,
 * Engines and Tools are what the Agents window held: the person's agents and personas and how
 * they behave, the engines' CLIs, and everything those engines can use.
 */
export const settingsGroups: readonly { label: string; areas: readonly SettingsArea[] }[] = [
  { label: "Account", areas: ["account", "server"] },
  {
    label: "App",
    areas: ["general", "appearance", "shortcuts", "voice", "privacy", "advanced"],
  },
  { label: "Pages", areas: ["search", "space", "code"] },
  {
    label: "Agents",
    areas: ["agents", "personas", "models", "conversations", "tutor", "access"],
  },
  { label: "Engines", areas: ["clis", "channels", "environment", "usage"] },
  { label: "Tools", areas: ["plugins", "skills", "prompts", "mcp", "apps"] },
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
  block("search", "search", "Sources"),
  block("space", "space", "Home"),
  block("code", "editor", "Editor"),
  block("agents", "agents-list", "Team", "resource"),
  block("personas", "agents-personas", "Personas", "resource"),
  block("models", "models", "Engine"),
  block("conversations", "agents-defaults", "Conversations"),
  block("tutor", "agents-companion", "Tutor"),
  block("access", "agents-permissions", "Access", "resource"),
  block("access", "agents-computer-use", "Computer use"),
  block("clis", "engines-clis", "Setup", "resource"),
  block("channels", "engines-channels", "Channels", "resource"),
  block("environment", "engines-environment", "Environment", "resource"),
  block("usage", "engines-usage", "Usage", "resource"),
  block("plugins", "tools-plugins", "Plugins", "resource"),
  block("skills", "tools-skills", "Skills", "resource"),
  block("prompts", "tools-prompts", "Prompts", "resource"),
  block("mcp", "tools-mcp", "Connectors", "resource"),
  block("apps", "tools-apps", "Apps", "resource"),
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
