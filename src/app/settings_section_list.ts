import type { ComponentType } from "react";
import type { settingsSectionIds } from "./settings_sections";
import { AccountSection, ServerSection, SessionsSection } from "@/features/account";
import { RequestsSection, StatusSection } from "@/features/direct";
import {
  AgentActivitySettings,
  AgentDefaultsSection,
  AgentPermissionsSection,
  CompanionSection,
  EngineSection,
} from "@/features/agents";
import {
  AccessibilitySection,
  AdvancedSection,
  AppearanceSection,
  MenuBarSection,
} from "@/features/app-windows";
import { PrivacySection } from "@/features/browser";
import { FontsSection } from "@/features/engine-config/fonts";
import { NetworkSection } from "@/features/engine-config/network";
import { DiagnosticsSection, PerformanceSection } from "@/features/engine-config/performance";
import {
  GeneralSection,
  NotificationsSection,
  type SettingsContentProps,
} from "@/features/settings";
import { DriveSettingsSection } from "@/features/spaces/drive";
import { FilesSettingsSection } from "@/features/spaces/file-manager";
import { AppsSettingsSection } from "@/features/spaces/apps";
import { ShortcutsSection } from "@/features/shortcuts";
import { UpdatesSection } from "@/features/updater";
import { DevicesSection, VoiceSection } from "@/features/voice";
import { ComputerUseSection } from "@/features/computer-use";
import { PetsSection } from "@/features/pets";
import { agentsSettingsSections } from "./AgentsSettingsSections";
import { BottomBarSettings } from "./layouts/DesktopLayout/BottomBarSettings";
import { SearchSettings } from "./layouts/DesktopLayout/search/SearchSettings";

export const settingsSections = {
  general: GeneralSection,
  updates: UpdatesSection,
  account: AccountSection,
  status: StatusSection,
  requests: RequestsSection,
  sessions: SessionsSection,
  notifications: NotificationsSection,
  server: ServerSection,
  drive: DriveSettingsSection,
  "menu-bar": MenuBarSection,
  appearance: AppearanceSection,
  fonts: FontsSection,
  accessibility: AccessibilitySection,
  shortcuts: ShortcutsSection,
  voice: VoiceSection,
  devices: DevicesSection,
  privacy: PrivacySection,
  "agent-activity": AgentActivitySettings,
  advanced: AdvancedSection,
  network: NetworkSection,
  performance: PerformanceSection,
  diagnostics: DiagnosticsSection,
  models: EngineSection,
  "agents-defaults": AgentDefaultsSection,
  "agents-companion": CompanionSection,
  "agents-permissions": AgentPermissionsSection,
  "agents-computer-use": ComputerUseSection,
  pets: PetsSection,
  "bottom-bar": BottomBarSettings,
  search: SearchSettings,
  thumbnails: FilesSettingsSection,
  "apps-data": AppsSettingsSection,
  ...agentsSettingsSections,
} satisfies Record<(typeof settingsSectionIds)[number], ComponentType<SettingsContentProps>>;
