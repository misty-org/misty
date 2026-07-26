import { memo, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import { Badge } from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Switch } from "@/ui";
import { Slider } from "@/ui";
import { Spinner } from "@/ui";
import {
  AppWindow,
  ArrowLeftRight,
  Bell,
  Bot,
  Cloud,
  Copy,
  Eye,
  FolderOpen,
  HardDrive,
  Image,
  Keyboard,
  Lock,
  RefreshCcw,
  Rows3,
  Search,
  Settings2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { InstallerCard } from "@/features/installer/InstallerCard";
import { useAppStore } from "@/stores/app";
import { settingsIndexToThemeMode, themeModeToSettingsIndex, useAppThemeStore } from "@/stores/app";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  SearchStatus,
  ShortcutBinding,
} from "@/models/interfaces/services/misty-api";
import { selectAgentPreferences, useSettingsStore } from "@/stores/app";
import { useSearchStore } from "@/stores/explorer";
import { formatDate } from "@/features/explorer/utils/fileFormat";
import { userFacingErrorText } from "@/lib/format";
import { hasTauriInternals } from "@/platform/tauri";
import { isAndroidBuild } from "@/platform/buildTarget";
import {
  defaultTransferProfileId,
  transferProfileRecords,
  transferProfileSettingsPayload,
} from "@/pages/Settings/transferProfiles";
import type { TransferProfileRecord } from "@/models/interfaces/pages/Settings/transferProfiles";
import {
  DesktopSettingsFrame,
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/pages/Settings/DesktopSettingsUI";

import type { SettingsSection, SettingValue } from "@/models/types/pages/Settings/desktop/index";

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
