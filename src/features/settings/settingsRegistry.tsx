import {
  Blocks,
  Cpu,
  Globe,
  History,
  KeyRound,
  Keyboard,
  MessagesSquare,
  Mic,
  MonitorSmartphone,
  MousePointer2,
  Palette,
  RefreshCw,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { ModelsSection } from "./models/ModelsSection";
import type { SettingOwnership } from "./devicePreferences/registry";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";

/** Most pages are empty while the Settings surface is being rebuilt; Models is the first back. */
export type SettingsArea =
  | "general"
  | "appearance"
  | "shortcuts"
  | "voice"
  | "privacy"
  | "devices"
  | "sync"
  | "browsing"
  | "passwords"
  | "conversations"
  | "cursor"
  | "apps"
  | "permissions"
  | "memory"
  | "models";

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
  devices: { label: "Devices", icon: MonitorSmartphone },
  sync: { label: "Sync", icon: RefreshCw },
  browsing: { label: "Browsing", icon: Globe },
  passwords: { label: "Passwords", icon: KeyRound },
  conversations: { label: "Conversations", icon: MessagesSquare },
  cursor: { label: "Cursor", icon: MousePointer2 },
  apps: { label: "Apps", icon: Blocks },
  permissions: { label: "Permissions", icon: ShieldCheck },
  memory: { label: "Memory", icon: History },
  models: { label: "Models", icon: Cpu },
};

export const settingsGroups: readonly { label: string; areas: readonly SettingsArea[] }[] = [
  { label: "Agents", areas: ["models"] },
];

export interface SettingsRegistryEntry {
  id: SettingsSection;
  label: string;
  area: SettingsArea;
  Component: ComponentType<SettingsContentProps>;
  owner: SettingOwnership;
  native?: boolean;
}

export const settingsRegistry: readonly SettingsRegistryEntry[] = [
  { id: "models", label: "Models", area: "models", Component: ModelsSection, owner: "device" },
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
        "browser-performance": "browser-tabs",
        browser: "search",
        "browser-privacy": "sync",
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

export function settingsPageTitle(entry: SettingsRegistryEntry): string {
  return settingsAreas[entry.area].label;
}

export function settingsAreaEntry(area: SettingsArea): SettingsRegistryEntry | undefined {
  return settingsRegistry.find((entry) => entry.area === area);
}

export function settingsAreaIsNativeOnly(_area: SettingsArea): boolean {
  return false;
}
