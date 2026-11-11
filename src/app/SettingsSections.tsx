import type { ComponentType } from "react";
import { AccountSection, ServerSection } from "@/features/account";
import {
  AgentDefaultsSection,
  AgentPermissionsSection,
  CompanionSection,
  MistySection,
  ModelsSection,
} from "@/features/agents";
import { AdvancedSection, AppearanceSection, TabsSettings } from "@/features/app-windows";
import { BrowserPermissionSettings, DownloadsSettings, PrivacySection } from "@/features/browser";
import { MemorySection } from "@/features/memory";
import {
  GeneralSection,
  registerSettingsSections,
  type SettingsContentProps,
  type SettingsSection,
} from "@/features/settings";
import { ShortcutsSection } from "@/features/shortcuts";
import { SyncSection } from "@/features/sync";
import { UpdatesSection } from "@/features/updater";
import { VoiceSection } from "@/features/voice";

function MistyMemorySection(props: SettingsContentProps) {
  return <MistySection {...props} page="memory" />;
}

/**
 * Each feature owns the settings blocks of its own area. The settings page only knows block ids,
 * so this is the one place that hands the components over, once, before a settings page opens.
 */
const sections: Partial<Record<SettingsSection, ComponentType<SettingsContentProps>>> = {
  general: GeneralSection,
  "browser-tabs": TabsSettings,
  "browser-downloads": DownloadsSettings,
  updates: UpdatesSection,
  account: AccountSection,
  server: ServerSection,
  appearance: AppearanceSection,
  shortcuts: ShortcutsSection,
  voice: VoiceSection,
  privacy: PrivacySection,
  "browser-permissions": BrowserPermissionSettings,
  advanced: AdvancedSection,
  sync: SyncSection,
  models: ModelsSection,
  "agents-defaults": AgentDefaultsSection,
  misty: MistySection,
  "agents-companion": CompanionSection,
  "agents-permissions": AgentPermissionsSection,
  recall: MemorySection,
  "agents-memory": MistyMemorySection,
};

registerSettingsSections(sections);
