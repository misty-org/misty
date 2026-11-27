import {
  Keyboard,
  Lock,
  MousePointer2,
  Palette,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  UserCircle,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { lazy, type ComponentType } from "react";
import { appIcons, spaceIcons } from "@misty/ui";
import type { SettingOwnership } from "./device-preferences/registry";
import type { SettingsContentProps, SettingsSection } from "./settings_types";

export { preferenceSection, preferencesWithoutRows } from "./settings_routing";

type SettingsArea =
  | "profile"
  | "privacy"
  | "server"
  | "general"
  | "interface"
  | "voice"
  | "shortcuts"
  | "advanced"
  | "agents"
  | "permissions"
  | "tutor"
  | "engines";

interface SettingsAreaInfo {
  label: string;
  icon: LucideIcon;
}

export const settingsAreas: Record<SettingsArea, SettingsAreaInfo> = {
  profile: { label: "Profile", icon: UserCircle },
  privacy: { label: "Privacy", icon: Lock },
  server: { label: "Server", icon: Server },
  general: { label: "General", icon: SlidersHorizontal },
  interface: { label: "Interface", icon: Palette },
  voice: { label: "Voice", icon: appIcons.speech },
  shortcuts: { label: "Shortcuts", icon: Keyboard },
  advanced: { label: "Advanced", icon: Wrench },
  agents: { label: "Agents", icon: spaceIcons.agents },
  permissions: { label: "Permissions", icon: ShieldCheck },
  tutor: { label: "Cursor", icon: MousePointer2 },
  engines: { label: "Engines", icon: appIcons.engines },
};

export const settingsGroups: readonly { label: string; areas: readonly SettingsArea[] }[] = [
  { label: "Account", areas: ["profile", "privacy", "server"] },
  { label: "App", areas: ["general", "interface", "voice", "shortcuts", "advanced"] },
  { label: "AI", areas: ["agents", "permissions", "tutor", "engines"] },
];

interface SettingsBlock {
  id: SettingsSection;
  area: SettingsArea;
  title?: string;
  owner: SettingOwnership;
  also: readonly SettingsSection[];
  tour?: string;
}

interface SettingsRegistryEntry extends SettingsBlock {
  Component: ComponentType<SettingsContentProps>;
}

const section = (
  area: SettingsArea,
  id: SettingsSection,
  title: string | undefined,
  options: { owner?: SettingOwnership; also?: readonly SettingsSection[]; tour?: string } = {},
): SettingsBlock => ({
  area,
  id,
  title,
  owner: options.owner ?? "device",
  also: options.also ?? [],
  tour: options.tour,
});

const resource = { owner: "resource" } as const;

const settingsBlocks: readonly SettingsBlock[] = [
  section("profile", "account", "Details", resource),
  section("profile", "status", "Status", resource),
  section("profile", "sessions", "Sessions", resource),
  section("profile", "account-removal", "Account removal", resource),
  section("privacy", "requests", "Friends", resource),
  section("privacy", "privacy", "This computer", { also: ["apps-data"] }),
  section("server", "server", "Connection"),
  section("server", "drive", "Drive", { also: ["thumbnails"] }),
  section("general", "general", "Startup", { also: ["menu-bar"] }),
  section("general", "notifications", "Notifications"),
  section("general", "search", "Search"),
  section("general", "browser", "Browser"),
  section("general", "updates", "Updates"),
  section("interface", "appearance", "Theme"),
  section("interface", "display", "Display", { also: ["accessibility"] }),
  section("interface", "fonts", "Fonts"),
  section("interface", "bottom-bar", "Bottom bar"),
  section("interface", "pets", "Pet"),
  section("voice", "voice", "Dictation"),
  section("voice", "speech", "Speech"),
  section("voice", "speaking", "Speaking"),
  section("voice", "listening", "Listening", { also: ["devices"] }),
  section("voice", "voice-models", "On this computer"),
  section("shortcuts", "shortcuts", undefined),
  section("advanced", "network", "Network", { also: ["advanced"] }),
  section("advanced", "performance", "Performance"),
  section("advanced", "diagnostics", "Diagnostics"),
  section("agents", "agents-list", "Your agents", { ...resource, tour: "agents-list" }),
  section("agents", "agents-defaults", "Chats"),
  section("agents", "agents-screens", "Screens"),
  section("agents", "agent-activity", "Activity"),
  section("permissions", "agents-permissions", "Limits", resource),
  section("permissions", "agents-approvals", "Approvals", resource),
  section("permissions", "agents-folders", "Shared folders", resource),
  section("permissions", "agents-sandbox", "Sandbox"),
  section("permissions", "agents-disk", "Disk"),
  section("permissions", "agents-computer-use", "Computer use"),
  section("tutor", "agents-companion", "Companion"),
  section("tutor", "tutor-behavior", "Behavior"),
  section("tutor", "tutor-talking", "Talking"),
  section("tutor", "tutor-tour", "Tour"),
  section("engines", "models", "Default"),
  section("engines", "engines-clis", "Installed", resource),
  section("engines", "engines-channels", undefined, resource),
  section("engines", "engines-environment", "Environment", resource),
  section("engines", "engines-usage", "Usage", resource),
  section("engines", "engines-limits", "Plan limits", resource),
  section("engines", "engines-logs", "Logs", resource),
];

export const settingsRegistry: SettingsRegistryEntry[] = [];

type SettingsComponents = Partial<Record<SettingsSection, ComponentType<SettingsContentProps>>>;

let sectionsLoad: Promise<SettingsComponents> | undefined;
let loadSections: (() => Promise<SettingsComponents>) | undefined;

export function preloadSettingsSections(): Promise<SettingsComponents | undefined> {
  if (!loadSections) return Promise.resolve(undefined);
  sectionsLoad ??= loadSections().catch((error: unknown) => {
    sectionsLoad = undefined;
    throw error;
  });
  return sectionsLoad;
}

const Missing: ComponentType<SettingsContentProps> = () => null;

export function registerSettingsSections(
  ids: readonly SettingsSection[],
  load: () => Promise<SettingsComponents>,
): void {
  settingsRegistry.length = 0;
  sectionsLoad = undefined;
  loadSections = load;
  for (const entry of settingsBlocks) {
    if (!ids.includes(entry.id)) continue;
    const Component = lazy(async () => {
      const components = await preloadSettingsSections();
      return { default: components?.[entry.id] ?? Missing };
    });
    settingsRegistry.push({ ...entry, Component });
  }
}

export function settingsPage(id: SettingsSection): SettingsRegistryEntry | undefined {
  return settingsRegistry.find((entry) => entry.id === id || entry.also.includes(id));
}

export function settingsPageTitle(entry: SettingsRegistryEntry): string {
  return settingsAreas[entry.area].label;
}

export function settingsAreaEntry(area: SettingsArea): SettingsRegistryEntry | undefined {
  return settingsRegistry.find((entry) => entry.area === area);
}
