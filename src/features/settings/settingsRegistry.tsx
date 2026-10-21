import { ExtensionsSettings } from "@/features/extensions/ExtensionsSettings";
import { BrowserSyncSettings } from "@/features/browser-workspace/BrowserSyncSettings";
import {
  Blocks,
  Download,
  Gauge,
  History,
  KeyRound,
  Keyboard,
  MessagesSquare,
  Mic,
  MousePointer2,
  Palette,
  Puzzle,
  Search,
  Shield,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { SettingOwnership } from "./profiles/registry";
import { AdvancedSection } from "./sections/AdvancedSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { BrowserPermissionSettings } from "./sections/BrowserPermissionSettings";
import {
  BrowserLinksSettings,
  BrowserLookSettings,
  DownloadsSettings,
  PerformanceSettings,
  SearchSettings,
} from "./sections/BrowserSection";
import {
  AboutSection,
  AgentConnectionsSection,
  AgentDefaultsSection,
  AgentPermissionsSection,
  CompanionSection,
  DevicesSection,
} from "./sections/FeatureSections";
import { GeneralSection } from "./sections/GeneralSection";
import { MistySection } from "./sections/MistySection";
import { PasswordsSettings } from "./sections/PasswordsSettings";
import { PrivacySection } from "./sections/PrivacySection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { UpdatesSection } from "./sections/UpdatesSection";
import { UsageSection } from "./sections/UsageSection";
import { VoiceSection } from "./sections/VoiceSection";
import { MemorySection } from "./sections/MemorySection";
import { CodingToolsSection } from "./sections/CodingToolsSection";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";

/**
 * Sidebar pages. Each opens one scrolling page; the registry blocks of a page render on it in
 * order. Page names are one word and never echo their group's name.
 */
export type SettingsArea =
  | "general"
  | "appearance"
  | "shortcuts"
  | "voice"
  | "privacy"
  | "search"
  | "downloads"
  | "performance"
  | "passwords"
  | "extensions"
  | "conversations"
  | "cursor"
  | "apps"
  | "memory";
export interface SettingsAreaInfo {
  label: string;
  icon: LucideIcon;
}
export const settingsAreas: Record<SettingsArea, SettingsAreaInfo> = {
  general: { label: "General", icon: SlidersHorizontal },
  appearance: { label: "Appearance", icon: Palette },
  shortcuts: { label: "Shortcuts", icon: Keyboard },
  voice: { label: "Voice", icon: Mic },
  privacy: { label: "Privacy", icon: Shield },
  search: { label: "Search", icon: Search },
  downloads: { label: "Downloads", icon: Download },
  performance: { label: "Performance", icon: Gauge },
  passwords: { label: "Passwords", icon: KeyRound },
  extensions: { label: "Extensions", icon: Puzzle },
  conversations: { label: "Conversations", icon: MessagesSquare },
  cursor: { label: "Cursor", icon: MousePointer2 },
  apps: { label: "Apps", icon: Blocks },
  memory: { label: "Memory", icon: History },
};
/** Sidebar groups, named by feature, in sidebar order. */
export const settingsGroups: readonly { label: string; areas: readonly SettingsArea[] }[] = [
  { label: "Settings", areas: ["general", "appearance", "shortcuts", "voice", "privacy"] },
  { label: "Browser", areas: ["search", "downloads", "performance", "passwords", "extensions"] },
  { label: "Agents", areas: ["conversations", "cursor", "apps", "memory"] },
];
export interface SettingsRegistryEntry {
  id: SettingsSection;
  label: string;
  area: SettingsArea;
  Component: ComponentType<SettingsContentProps>;
  owner: SettingOwnership;
  native?: boolean;
}
const page = (
  area: SettingsArea,
  id: SettingsSection,
  label: string,
  Component: ComponentType<SettingsContentProps>,
  owner: SettingOwnership = "account",
  native = false,
): SettingsRegistryEntry => ({ area, id, label, Component, owner, native });
/** The blocks of each page, in page order; blocks of one page must be adjacent. */
export const settingsRegistry: readonly SettingsRegistryEntry[] = [
  page("general", "general", "Startup", GeneralSection),
  page("general", "browser-links", "Links", BrowserLinksSettings),
  page("general", "sync", "Sync", BrowserSyncSettings),
  page("general", "devices", "Devices", DevicesSection),
  page("general", "updates", "Updates", UpdatesSection, "account", true),
  page("general", "about", "About", AboutSection),
  page("general", "diagnostics", "Diagnostics", AdvancedSection, "account", true),
  page("appearance", "appearance", "Appearance", AppearanceSection),
  page("appearance", "browser-appearance", "Browser", BrowserLookSettings),
  page("shortcuts", "shortcuts", "Shortcuts", ShortcutsSection, "account", true),
  page("voice", "voice", "Voice", VoiceSection, "account", true),
  page("privacy", "privacy", "Privacy", PrivacySection),
  page(
    "privacy",
    "browser-permissions",
    "Website permissions",
    BrowserPermissionSettings,
    "resource",
    true,
  ),
  page("privacy", "agents-permissions", "Agent permissions", AgentPermissionsSection, "resource"),
  page("search", "search", "Search", SearchSettings),
  page("downloads", "browser-downloads", "Downloads", DownloadsSettings),
  page("performance", "browser-performance", "Performance", PerformanceSettings),
  page("passwords", "passwords", "Passwords", PasswordsSettings, "resource", true),
  page("extensions", "browser-extensions", "Extensions", ExtensionsSettings, "resource", true),
  page("conversations", "agents-defaults", "Conversations", AgentDefaultsSection),
  page("conversations", "misty", "Misty", MistySection),
  page("conversations", "agents-usage", "Usage", UsageSection),
  page("cursor", "agents-companion", "Cursor", CompanionSection),
  page("apps", "agents-connections", "Connected apps", AgentConnectionsSection, "resource"),
  page("apps", "agents-coding", "Coding tools", CodingToolsSection, "resource", true),
  page("memory", "agents-memory", "Remembered", (p) => <MistySection {...p} page="memory" />),
  page("memory", "recall", "Memory", MemorySection, "account", true),
];
/** Pages that no longer exist on their own resolve to where their settings now live. */
export function canonicalSettingsSection(section: SettingsSection): SettingsSection {
  return (
    (
      {
        advanced: "diagnostics",
        layout: "appearance",
        agents: "agents-defaults",
        support: "about",
        server: "about",
        account: "about",
        profiles: "sync",
        "browser-handoff": "sync",
        browser: "search",
        "browser-privacy": "privacy",
        "browser-import": "general",
        "spaces-defaults": "general",
        "spaces-manage": "general",
        social: "general",
        journal: "general",
        library: "general",
        terminal: "general",
        code: "general",
      } as Partial<Record<SettingsSection, SettingsSection>>
    )[section] ?? section
  );
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
