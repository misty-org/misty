import type { ComponentType } from "react";
import type { settingsSectionIds } from "./settings_sections";
import {
  AccountRemovalSection,
  AccountSection,
  ServerSection,
  SessionsSection,
} from "@/features/account";
import { RequestsSection, StatusSection } from "@/features/direct";
import {
  AgentActivitySettings,
  AgentDefaultsSection,
  AgentFoldersSection,
  AgentGrantsSection,
  AgentPermissionsSection,
  EngineSection,
  FilesAccessSection,
  SandboxPermissionsSection,
  ScreenLocationSection,
  TutorBehaviorSection,
  TutorSettings,
  TutorTalkingSection,
  TutorTourSection,
} from "@/features/agents";
import {
  AccessibilitySection,
  AppearanceSection,
  FramePacingRow,
  LinkPreviewsRow,
  MenuBarSection,
  PaneDisplayRows,
  WindowSection,
} from "@/features/app-windows";
import { BrowserSearchRows, PrivacySection } from "@/features/browser";
import { FontsSection } from "@/features/engine-config/fonts";
import { NetworkSection } from "@/features/engine-config/network";
import { DiagnosticsSection, PerformanceSection } from "@/features/engine-config/performance";
import {
  LaunchOnLoginRow,
  NotificationsSection,
  ReopenSessionRows,
  type SettingsContentProps,
} from "@/features/settings";
import { DriveSettingsSection } from "@/features/spaces/drive";
import { FilesSettingsSection } from "@/features/spaces/file-manager";
import { AppsSettingsSection } from "@/features/spaces/apps";
import { ShortcutHintsRow, ShortcutsSection } from "@/features/shortcuts";
import { UpdatesSection } from "@/features/updater";
import {
  ListeningSection,
  SpeakingSection,
  SpeechSection,
  VoiceModelsSection,
  VoiceSection,
} from "@/features/voice";
import { ComputerUseSection } from "@/features/computer-use";
import { PetsSection } from "@/features/pets";
import { agentsSettingsSections } from "./AgentsSettingsSections";
import { BottomBarSettings } from "./layouts/DesktopLayout/BottomBarSettings";
import { SearchSettings } from "./layouts/DesktopLayout/search/SearchSettings";

function StartupRows(props: SettingsContentProps) {
  return (
    <>
      <LaunchOnLoginRow {...props} />
      <MenuBarSection {...props} />
      <ReopenSessionRows {...props} />
    </>
  );
}

function PrivacyRows() {
  return (
    <>
      <PrivacySection />
      <AppsSettingsSection />
    </>
  );
}

function DriveRows(props: SettingsContentProps) {
  return (
    <>
      <DriveSettingsSection {...props} />
      <FilesSettingsSection {...props} />
    </>
  );
}

function DisplayRows(props: SettingsContentProps) {
  return (
    <>
      <WindowSection {...props} />
      <PaneDisplayRows {...props} />
      <AccessibilitySection {...props} />
      <LinkPreviewsRow {...props} />
      <ShortcutHintsRow {...props} />
    </>
  );
}

function DiagnosticsRows(props: SettingsContentProps) {
  return (
    <>
      <DiagnosticsSection />
      <FramePacingRow {...props} />
    </>
  );
}

export const settingsSections = {
  account: AccountSection,
  status: StatusSection,
  sessions: SessionsSection,
  "account-removal": AccountRemovalSection,
  requests: RequestsSection,
  privacy: PrivacyRows,
  server: ServerSection,
  drive: DriveRows,
  general: StartupRows,
  notifications: NotificationsSection,
  search: SearchSettings,
  browser: BrowserSearchRows,
  updates: UpdatesSection,
  appearance: AppearanceSection,
  display: DisplayRows,
  fonts: FontsSection,
  "bottom-bar": BottomBarSettings,
  pets: PetsSection,
  voice: VoiceSection,
  speech: SpeechSection,
  speaking: SpeakingSection,
  listening: ListeningSection,
  "voice-models": VoiceModelsSection,
  shortcuts: ShortcutsSection,
  network: NetworkSection,
  performance: PerformanceSection,
  diagnostics: DiagnosticsRows,
  "agents-defaults": AgentDefaultsSection,
  "agents-screens": ScreenLocationSection,
  "agent-activity": AgentActivitySettings,
  "agents-permissions": AgentPermissionsSection,
  "agents-approvals": AgentGrantsSection,
  "agents-folders": AgentFoldersSection,
  "agents-sandbox": SandboxPermissionsSection,
  "agents-disk": FilesAccessSection,
  "agents-computer-use": ComputerUseSection,
  "agents-companion": TutorSettings,
  "tutor-behavior": TutorBehaviorSection,
  "tutor-talking": TutorTalkingSection,
  "tutor-tour": TutorTourSection,
  models: EngineSection,
  ...agentsSettingsSections,
} satisfies Record<(typeof settingsSectionIds)[number], ComponentType<SettingsContentProps>>;
