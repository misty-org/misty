import { BrowserSyncSettings } from "@/features/browser-workspace/BrowserSyncSettings";
import {
  Bell,
  Folder,
  Globe,
  Info,
  Keyboard,
  Layers,
  MonitorSmartphone,
  Palette,
  PanelsTopLeft,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { SettingOwnership } from "./profiles/registry";
import { AdvancedSection } from "./sections/AdvancedSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { BrowserImportSettings } from "./sections/BrowserImportSettings";
import { BrowserPermissionSettings } from "./sections/BrowserPermissionSettings";
import { BrowserSection } from "./sections/BrowserSection";
import {
  AboutSection,
  AgentConnectionsSection,
  AgentDefaultsSection,
  AgentPermissionsSection,
  CompanionSection,
  DevicesSection,
  ManageSpacesSection,
  ModelsSection,
  SpaceAgendaSection,
  SpaceDefaultsSection,
} from "./sections/FeatureSections";
import { FilesSection } from "./sections/FilesSection";
import { GeneralSection } from "./sections/GeneralSection";
import { LayoutSection } from "./sections/LayoutSection";
import { MistySection } from "./sections/MistySection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { PrivacySection } from "./sections/PrivacySection";
import { SearchSection } from "./sections/SearchSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { UpdatesSection } from "./sections/UpdatesSection";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";

/**
 * Flat sidebar areas. Registry entries within an area render together on one page.
 * `breakBefore` preserves the incumbent group dividers; chevrons never expand lists.
 */
export type SettingsArea =
  | "general"
  | "appearance"
  | "layout"
  | "notifications"
  | "shortcuts"
  | "browser"
  | "files"
  | "spaces"
  | "agents"
  | "sync"
  | "devices"
  | "privacy"
  | "about";
export const settingsAreas: Record<
  SettingsArea,
  { label: string; icon: LucideIcon; breakBefore?: boolean }
> = {
  general: { label: "General", icon: SlidersHorizontal },
  appearance: { label: "Appearance", icon: Palette },
  layout: { label: "Layout", icon: PanelsTopLeft },
  notifications: { label: "Notifications", icon: Bell },
  shortcuts: { label: "Shortcuts", icon: Keyboard },
  browser: { label: "Browser", icon: Globe, breakBefore: true },
  files: { label: "Files", icon: Folder },
  spaces: { label: "Spaces", icon: Layers },
  agents: { label: "Agents", icon: Sparkles },
  sync: { label: "Sync", icon: RefreshCw, breakBefore: true },
  devices: { label: "Devices", icon: MonitorSmartphone },
  privacy: { label: "Privacy", icon: Shield },
  about: { label: "About", icon: Info },
};
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
/** Order here is sidebar order; pages of one area must be adjacent. */
export const settingsRegistry: readonly SettingsRegistryEntry[] = [
  page("general", "general", "General", GeneralSection),
  page("appearance", "appearance", "Appearance", AppearanceSection),
  page("layout", "layout", "Layout", LayoutSection, "resource", true),
  page("notifications", "notifications", "Notifications", NotificationsSection),
  page("shortcuts", "shortcuts", "Shortcuts", ShortcutsSection, "account", true),
  page("browser", "browser", "Browsing", BrowserSection),
  page("browser", "browser-downloads", "Downloads", (p) => (
    <BrowserSection {...p} page="downloads" />
  )),
  page(
    "browser",
    "browser-permissions",
    "Permissions",
    BrowserPermissionSettings,
    "resource",
    true,
  ),
  page("browser", "browser-import", "Other browsers", BrowserImportSettings, "resource", true),
  page(
    "browser",
    "browser-privacy",
    "Privacy",
    (p) => <PrivacySection {...p} page="browser" />,
    "account",
  ),
  page("files", "files", "Browsing", FilesSection),
  page(
    "files",
    "files-locations",
    "Locations",
    (p) => <FilesSection {...p} page="locations" />,
    "account",
    true,
  ),
  page("files", "search", "Search", (p) => <SearchSection {...p} page="search" />, "account", true),
  page(
    "files",
    "files-indexing",
    "Indexing",
    (p) => <SearchSection {...p} page="indexing" />,
    "account",
    true,
  ),
  page("spaces", "spaces-defaults", "Defaults", SpaceDefaultsSection),
  page("spaces", "spaces-agenda", "Agenda", SpaceAgendaSection),
  page("spaces", "spaces-manage", "Manage spaces", ManageSpacesSection, "resource"),
  page("agents", "agents-defaults", "Defaults", AgentDefaultsSection),
  page("agents", "models", "Models", ModelsSection, "account"),
  page("agents", "misty", "Misty", MistySection, "account"),
  page(
    "agents",
    "agents-memory",
    "Memory",
    (p) => <MistySection {...p} page="memory" />,
    "account",
  ),
  page("agents", "agents-connections", "Connections", AgentConnectionsSection, "resource"),
  page("agents", "agents-permissions", "Permissions", AgentPermissionsSection, "resource"),
  page("agents", "agents-companion", "Companion", CompanionSection, "account"),
  page("sync", "sync", "Sync", BrowserSyncSettings),
  page("devices", "devices", "Devices", DevicesSection, "account"),
  page("privacy", "privacy", "Privacy", PrivacySection, "account"),
  page("about", "about", "Version", AboutSection, "account"),
  page("about", "updates", "Updates", UpdatesSection, "account", true),
  page("about", "diagnostics", "Diagnostics", AdvancedSection, "account", true),
];
/** Pages that no longer exist on their own resolve to where their settings now live. */
export function canonicalSettingsSection(section: SettingsSection): SettingsSection {
  return (
    (
      {
        advanced: "diagnostics",
        agents: "agents-defaults",
        support: "about",
        server: "about",
        account: "general",
        profiles: "sync",
        "browser-handoff": "sync",
        social: "spaces-defaults",
        journal: "spaces-defaults",
        planner: "spaces-agenda",
        library: "spaces-manage",
        terminal: "general",
        code: "general",
      } as Partial<Record<SettingsSection, SettingsSection>>
    )[section] ?? section
  );
}
export function settingsPage(section: SettingsSection): SettingsRegistryEntry | undefined {
  return settingsRegistry.find((entry) => entry.id === section);
}
/** "Browser / Downloads" for pages inside a multi-page area, "General" otherwise. */
export function settingsPageTitle(entry: SettingsRegistryEntry): string {
  const siblings = settingsRegistry.filter((item) => item.area === entry.area).length;
  return siblings > 1 ? `${settingsAreas[entry.area].label} / ${entry.label}` : entry.label;
}
