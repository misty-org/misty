import type { useAppStore } from "@/features/app-shell";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  ShortcutBinding,
} from "@/services/misty/model/misty-api";
import { type LucideIcon } from "lucide-react";

export type SettingsSection =
  | "general"
  | "app"
  | "agent"
  | "appearance"
  | "notifications"
  | "privacy"
  | "transfers"
  | "search"
  | "shortcuts"
  | "advanced";

export type SettingValue =
  string | number | boolean | Record<string, unknown> | Array<Record<string, unknown>>;

export interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}

export interface SettingsContentProps {
  document: Record<string, unknown>;
  launchOnLogin: LaunchOnLoginSnapshot | null;
  working: boolean;
  onSettingChange: (section: string, key: string, value: SettingValue) => void;
  onLoad: () => Promise<void>;
  onShortcutChange: (commandId: string, shortcut: string) => void;
  onSaveShortcuts: () => Promise<void>;
  onRemoveOpenWithAssociation: (key: string) => Promise<void>;
  shortcuts: ShortcutBinding[];
  openWithAssociations: OpenWithAssociation[];
  app: ReturnType<typeof useAppStore.getState>["app"];
}
