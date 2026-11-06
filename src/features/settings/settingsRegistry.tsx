import { ExtensionsSettings } from "@/features/extensions/ExtensionsSettings";
import {
  Brain,
  Cloud,
  EyeOff,
  KeyRound,
  Keyboard,
  MessagesSquare,
  Mic,
  Palette,
  Puzzle,
  Server,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  UserCircle,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { SettingOwnership } from "./devicePreferences/registry";
import { AdvancedSection } from "./sections/AdvancedSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { AutofillSettings } from "./sections/AutofillSettings";
import { BrowserPermissionSettings } from "./sections/BrowserPermissionSettings";
import { BrowserLinksSettings, DownloadsSettings } from "./sections/BrowserSection";
import { ModelsSection } from "./models/ModelsSection";
import {
  AgentDefaultsSection,
  AgentPermissionsSection,
  CompanionSection,
} from "./sections/FeatureSections";
import { GeneralSection } from "./sections/GeneralSection";
import { MemorySection } from "./sections/MemorySection";
import { MistySection } from "./sections/MistySection";
import { PasswordsSettings } from "./sections/PasswordsSettings";
import { PrivacySection } from "./sections/PrivacySection";
import { AccountSection } from "./sections/account/AccountSection";
import { ServerSection } from "./sections/ServerSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { SyncSection } from "./sections/SyncSection";
import { TabsSettings } from "./sections/TabsSettings";
import { UpdatesSection } from "./sections/UpdatesSection";
import { VoiceSection } from "./sections/VoiceSection";
import { canonicalSettingsSection } from "./settingsRouting";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";

export {
  canonicalSettingsSection,
  preferenceSection,
  preferencesWithoutRows,
} from "./settingsRouting";

/**
 * Sidebar pages. Each opens one scrolling page; the registry blocks of a page render on it in
 * order. Page names are one word that never echoes its group's name (docs/settings/README.md).
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
  | "passwords"
  | "extensions"
  | "sync"
  | "models"
  | "conversations"
  | "access"
  | "memory";

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
  passwords: { label: "Passwords", icon: KeyRound },
  extensions: { label: "Extensions", icon: Puzzle },
  sync: { label: "Sync", icon: Cloud },
  models: { label: "Models", icon: Sparkles },
  conversations: { label: "Behavior", icon: MessagesSquare },
  access: { label: "Access", icon: ShieldCheck },
  memory: { label: "Memory", icon: Brain },
};

/** Sidebar groups, named by feature, in sidebar order. */
export const settingsGroups: readonly { label: string; areas: readonly SettingsArea[] }[] = [
  { label: "Account", areas: ["account", "server"] },
  {
    label: "App",
    areas: ["general", "appearance", "shortcuts", "voice", "privacy", "advanced"],
  },
  { label: "Browser", areas: ["passwords", "extensions", "sync"] },
  { label: "Agents", areas: ["models", "conversations", "access", "memory"] },
];

interface SettingsRegistryEntry {
  id: SettingsSection;
  label: string;
  area: SettingsArea;
  Component: ComponentType<SettingsContentProps>;
  owner: SettingOwnership;
}

const block = (
  area: SettingsArea,
  id: SettingsSection,
  label: string,
  Component: ComponentType<SettingsContentProps>,
  owner: SettingOwnership = "device",
): SettingsRegistryEntry => ({ area, id, label, Component, owner });

function MistyMemorySection(props: SettingsContentProps) {
  return <MistySection {...props} page="memory" />;
}

/** The blocks of each page, in page order; blocks of one page are adjacent. */
export const settingsRegistry: readonly SettingsRegistryEntry[] = [
  block("general", "general", "Startup", GeneralSection),
  block("general", "browser-links", "Browsing", BrowserLinksSettings),
  block("general", "browser-tabs", "Tabs", TabsSettings),
  block("general", "browser-downloads", "Downloads", DownloadsSettings),
  block("general", "updates", "Updates", UpdatesSection),
  block("account", "account", "Profile", AccountSection, "resource"),
  block("server", "server", "Server", ServerSection),
  block("appearance", "appearance", "Appearance", AppearanceSection),
  block("shortcuts", "shortcuts", "Shortcuts", ShortcutsSection),
  block("voice", "voice", "Voice", VoiceSection),
  block("privacy", "privacy", "Privacy", PrivacySection),
  block("privacy", "browser-permissions", "Websites", BrowserPermissionSettings, "resource"),
  block("advanced", "advanced", "Advanced", AdvancedSection),
  block("passwords", "passwords", "Passwords", PasswordsSettings, "resource"),
  block("passwords", "autofill", "Autofill", AutofillSettings),
  block("extensions", "browser-extensions", "Extensions", ExtensionsSettings, "resource"),
  block("sync", "sync", "Sync", SyncSection),
  block("models", "models", "Models", ModelsSection),
  block("conversations", "agents-defaults", "Conversations", AgentDefaultsSection),
  block("conversations", "misty", "Misty", MistySection, "resource"),
  block("conversations", "agents-companion", "Cursor", CompanionSection),
  block("access", "agents-permissions", "Access", AgentPermissionsSection, "resource"),
  block("memory", "recall", "Memory", MemorySection),
  block("memory", "agents-memory", "Remembered", MistyMemorySection, "resource"),
];

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
