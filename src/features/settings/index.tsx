import * as SettingsPageModule from "./SettingsPage";
export * from "./components/DesktopSettingsUI";
export * from "./hooks/useDocumentAppAppearance";
export { DevicePreferencesBridge } from "./devicePreferences/DevicePreferencesBridge";
export type { SettingsSection } from "./settingsTypes";
export * from "./store/appTheme";
export { settingsBoolean } from "./store/preferences";
export { PreferenceRow } from "./sections/PreferenceRow";
export { SyncRestoreSettings } from "./sections/SyncRestoreSettings";
export * from "./store/useAppThemeStore";
export * from "./store/useSettingsStore";
/** Resolves the already loaded Settings page for callers that warm it on hover. */
export function preloadSettingsWorkspace(): Promise<typeof SettingsPageModule> {
  return Promise.resolve(SettingsPageModule);
}
export type SettingsWorkspaceProps = {
  presentation?: "page" | "overlay";
  onClose?: () => void;
};
export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  return <SettingsPageModule.SettingsWorkspace {...props} />;
}
export { blockIfUnsaved, useDevicePreferences } from "./devicePreferences/store";
export { resolveSetting } from "./devicePreferences/model";
export { ModelKeyNeededButton, needsModelKey } from "./models/ModelKeyNeeded";
export { openModelSettings } from "./models/modelKeys";
