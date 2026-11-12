import * as SettingsPageModule from "./SettingsPage";
export * from "./components/DesktopSettingsUI";
export * from "./hooks/useDocumentAppAppearance";
export type { SettingsSection } from "./settingsTypes";
export * from "./preferences/appTheme";
export { settingsBoolean, settingsNumber, settingsString } from "./preferences/preferences";
export { onSettingsApplied } from "./preferences/settingsSideEffects";
export { PreferenceRow } from "./sections/PreferenceRow";
export * from "./preferences/useAppThemeStore";
export * from "./preferences/useSettingsStore";
/** Resolves the already loaded Settings page for callers that warm it on hover. */
export function preloadSettingsWorkspace(): Promise<typeof SettingsPageModule> {
  return Promise.resolve(SettingsPageModule);
}
type SettingsWorkspaceProps = {
  presentation?: "page" | "overlay";
  onClose?: () => void;
};
export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  return <SettingsPageModule.SettingsWorkspace {...props} />;
}
export { blockIfUnsaved, useDevicePreferences } from "./device-preferences/store";
export { resolveSetting } from "./device-preferences/settingResolution";
export { openSettings, openSettingsEvent, type OpenSettingsDetail } from "./openSettings";

// Public surface used by other features (generated from their imports).
export {
  DesktopSettingsNotice,
  DesktopSettingsRow,
  DesktopSettingsSection,
} from "./components/DesktopSettingsUI";
export { mutateState } from "./device-preferences/persistence";
export { definitionById, fromLegacy } from "./device-preferences/registry";
export { validClockTime } from "./preferences/nightLight";
export { useSettingsStore } from "./preferences/useSettingsStore";
export { GeneralSection } from "./sections/GeneralSection";
export { registerSettingsSections } from "./settingsRegistry";
export type { SettingsContentProps } from "./settingsTypes";
export { workspaceDefaultViewIndex } from "./settingsConstants";
export { searchSettings, type SettingsSearchResult } from "./components/SettingsSearchResults";
