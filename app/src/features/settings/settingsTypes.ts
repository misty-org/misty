import type { useAppStore } from "@/features/app-shell";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  ShortcutBinding,
} from "@/native/contracts";
import { type LucideIcon } from "lucide-react";

export type SettingsSection =
  | "general"
  | "appearance"
  | "notifications"
  | "shortcuts"
  | "files"
  | "search"
  | "transfers"
  | "browser"
  | "terminal"
  | "code"
  | "models"
  | "agents"
  | "extensions"
  | "privacy"
  | "updates"
  | "advanced";

export type SettingValue =
  string | number | boolean | Record<string, unknown> | Array<Record<string, unknown>>;

export interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group?: string;
  groupLabel?: string;
}

export interface SettingsContentProps {
  document: Record<string, unknown>;
  launchOnLogin: LaunchOnLoginSnapshot | null;
  working: boolean;
  onSettingChange: (section: string, key: string, value: SettingValue) => void;
  onLoad: () => Promise<void>;
  onShortcutChange: (commandId: string, shortcut: string) => void;
  onSaveShortcuts: () => Promise<void>;
  onResetShortcuts: () => Promise<void>;
  onRemoveOpenWithAssociation: (key: string) => Promise<void>;
  shortcuts: ShortcutBinding[];
  openWithAssociations: OpenWithAssociation[];
  app: ReturnType<typeof useAppStore.getState>["app"];
}
