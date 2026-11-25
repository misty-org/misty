import { lazy, Suspense } from "react";
import type * as SettingsPageModule from "./SettingsPage";
import { preloadSettingsSections } from "./SettingsRegistry";
export * from "./components/DesktopSettingsUI";
export * from "./hooks/use_document_app_appearance";
export type { SettingsSection } from "./settings_types";
export type { DesktopSettingsNavGroup } from "./components/SettingsNavigation";
export * from "./preferences/app_theme";
export { settingsBoolean, settingsNumber, settingsString } from "./preferences/preferences";
export { onSettingsApplied } from "./preferences/settings_side_effects";
export { PreferenceRow } from "./sections/PreferenceRow";
export * from "./preferences/use_app_theme_store";
export * from "./preferences/use_settings_store";
const loadSettingsPage = () => import("./SettingsPage");
export function preloadSettingsWorkspace(): Promise<typeof SettingsPageModule> {
  return Promise.all([loadSettingsPage(), preloadSettingsSections()]).then(([page]) => page);
}
const Workspace = lazy(async () => ({ default: (await loadSettingsPage()).SettingsWorkspace }));
type SettingsWorkspaceProps = {
  presentation?: "page" | "overlay";
  onClose?: () => void;
};
export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  return (
    <Suspense fallback={null}>
      <Workspace {...props} />
    </Suspense>
  );
}
export { blockIfUnsaved, useDevicePreferences } from "./device-preferences/store";
export { resolveSetting } from "./device-preferences/setting_resolution";
export {
  openSettings,
  openSettingsEvent,
  useSettingsOpen,
  type OpenSettingsDetail,
} from "./open_settings";

export {
  DesktopSettingsNotice,
  DesktopSettingsRow,
  DesktopSettingsSection,
} from "./components/DesktopSettingsUI";
export { mutateState } from "./device-preferences/persistence";
export { definitionById, fromLegacy } from "./device-preferences/registry";
export { validClockTime } from "./preferences/night_light";
export { applyCachedAppTheme } from "./preferences/app_theme";
export { useSettingsStore } from "./preferences/use_settings_store";
export { LaunchOnLoginRow, ReopenSessionRows } from "./sections/GeneralSection";
export { NotificationsSection } from "./sections/NotificationsSection";
export { preloadSettingsSections, registerSettingsSections } from "./SettingsRegistry";
export type { SettingsContentProps } from "./settings_types";
export { searchSettings } from "./components/SettingsSearchResults";
