import type { ComponentType } from "react";
import { AccountSection, ServerSection } from "@/features/account";
import {
  AgentActivitySettings,
  AgentDefaultsSection,
  AgentPermissionsSection,
  CompanionSection,
  MistySection,
  ModelsSection,
  PersonaCatalogSection,
} from "@/features/agents";
import { AdvancedSection, AppearanceSection } from "@/features/app-windows";
import { BrowserPermissionSettings, PrivacySection } from "@/features/browser";
import { ChannelsSection } from "@/features/engine-config/channels";
import { ClisSection } from "@/features/engine-config/clis";
import { FontsSection } from "@/features/engine-config/fonts";
import { McpSection } from "@/features/engine-config/mcp";
import { NetworkSection } from "@/features/engine-config/network";
import { PerformanceSection } from "@/features/engine-config/performance";
import { PromptsSection } from "@/features/engine-config/prompts";
import { SkillsSection } from "@/features/engine-config/skills";
import { UsageSection } from "@/features/engine-config/usage";
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
  shortcuts: ShortcutsSection,
  voice: VoiceSection,
  privacy: PrivacySection,
  "browser-permissions": BrowserPermissionSettings,
  "agent-activity": AgentActivitySettings,
  advanced: AdvancedSection,
  network: NetworkSection,
  performance: PerformanceSection,
  models: ModelsSection,
  "engine-clis": ClisSection,
  "engine-channels": ChannelsSection,
  "engine-usage": UsageSection,
  "engine-mcp": McpSection,
  "engine-skills": SkillsSection,
  "engine-prompts": PromptsSection,
  "agents-defaults": AgentDefaultsSection,
  misty: MistySection,
  "agents-companion": CompanionSection,
  "agents-permissions": AgentPermissionsSection,
  "agents-personas": PersonaCatalogSection,
  "agents-computer-use": ComputerUseSection,
  pets: PetsSection,
};

registerSettingsSections(sections);
