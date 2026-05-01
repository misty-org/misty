import type { useAppStore } from "@/features/app-shell";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  ShortcutBinding,
} from "@/native/contracts";
import { type LucideIcon } from "lucide-react";

import type { SettingsSection, SettingValue } from "../../page-types/workspace/index";

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
