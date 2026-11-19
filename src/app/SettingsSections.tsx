import type { ComponentType } from "react";
import { AccountSection, ServerSection } from "@/features/account";
import {
  AgentActivitySettings,
  AgentDefaultsSection,
  AgentPermissionsSection,
  CompanionSection,
  EditorSettings,
  EngineSection,
} from "@/features/agents";
import { AdvancedSection, AppearanceSection } from "@/features/app-windows";
import { PrivacySection } from "@/features/browser";
import { FontsSection } from "@/features/engine-config/fonts";
import { NetworkSection } from "@/features/engine-config/network";
import { PerformanceSection } from "@/features/engine-config/performance";
import {
  GeneralSection,
  registerSettingsSections,
  type SettingsContentProps,
  type SettingsSection,
} from "@/features/settings";
import { ShortcutsSection } from "@/features/shortcuts";
import { UpdatesSection } from "@/features/updater";
import { VoiceSection } from "@/features/voice";
import { ComputerUseSection } from "@/features/computer-use";
import { PetsSection } from "@/features/pets";
import { SpaceSettings } from "@/features/spaces";
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
  server: ServerSection,
  appearance: AppearanceSection,
  fonts: FontsSection,
  editor: EditorSettings,
  shortcuts: ShortcutsSection,
  voice: VoiceSection,
  privacy: PrivacySection,
  "agent-activity": AgentActivitySettings,
  advanced: AdvancedSection,
  network: NetworkSection,
  performance: PerformanceSection,
  models: EngineSection,
  "agents-defaults": AgentDefaultsSection,
  "agents-companion": CompanionSection,
  "agents-permissions": AgentPermissionsSection,
  "agents-computer-use": ComputerUseSection,
  pets: PetsSection,
  "bottom-bar": BottomBarSettings,
  search: SearchSettings,
  space: SpaceSettings,
  ...agentsSettingsSections,
};

registerSettingsSections(sections);
