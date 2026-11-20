import type { ComponentType } from "react";
import { AccountSection, RequestsSection, ServerSection, StatusSection } from "@/features/account";
import {
  AgentActivitySettings,
  AgentDefaultsSection,
  AgentPermissionsSection,
  CollaborationSettings,
  CompanionSection,
  EditorSettings,
  EngineSection,
} from "@/features/agents";
import { AccessibilitySection, AdvancedSection, AppearanceSection } from "@/features/app-windows";
import { PrivacySection } from "@/features/browser";
import { FontsSection } from "@/features/engine-config/fonts";
import { NetworkSection } from "@/features/engine-config/network";
import { DiagnosticsSection, PerformanceSection } from "@/features/engine-config/performance";
import {
  GeneralSection,
  NotificationsSection,
  registerSettingsSections,
  type SettingsContentProps,
  type SettingsSection,
} from "@/features/settings";
import { DriveSettingsSection } from "@/features/spaces/drive";
import { ShortcutsSection } from "@/features/shortcuts";
import { UpdatesSection } from "@/features/updater";
import { DevicesSection, VoiceSection } from "@/features/voice";
import { ComputerUseSection } from "@/features/computer-use";
import { PetsSection } from "@/features/pets";
import { agentsSettingsSections } from "./AgentsSettingsSections";
import { BottomBarSettings } from "./layouts/DesktopLayout/BottomBarSettings";
import { SearchSettings } from "./layouts/DesktopLayout/search/SearchSettings";

/**
 * Each feature owns the settings blocks of its own area. The settings page only knows block ids,
 * so this is the one place that hands the components over, once, before a settings page opens.
 */
const sections: Partial<Record<SettingsSection, ComponentType<SettingsContentProps>>> = {
  general: GeneralSection,
  updates: UpdatesSection,
  account: AccountSection,
  status: StatusSection,
  requests: RequestsSection,
  notifications: NotificationsSection,
  server: ServerSection,
  drive: DriveSettingsSection,
  appearance: AppearanceSection,
  fonts: FontsSection,
  accessibility: AccessibilitySection,
  editor: EditorSettings,
  collaboration: CollaborationSettings,
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
  ...agentsSettingsSections,
};

registerSettingsSections(sections);
