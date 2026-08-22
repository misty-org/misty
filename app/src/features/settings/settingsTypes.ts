import type { useAppStore } from "@/features/app-shell";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  ReassignShortcutRequest,
  ResetShortcutRequest,
  ShortcutsSnapshot,
  UpdateShortcutRequest,
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
  | "misty"
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
  onShortcutChange: (request: UpdateShortcutRequest) => Promise<void>;
  onShortcutReassign: (request: ReassignShortcutRequest) => Promise<void>;
  onResetShortcuts: (request?: ResetShortcutRequest) => Promise<void>;
  onRemoveOpenWithAssociation: (key: string) => Promise<void>;
  shortcuts: ShortcutsSnapshot | null;
  openWithAssociations: OpenWithAssociation[];
  app: ReturnType<typeof useAppStore.getState>["app"];
}
