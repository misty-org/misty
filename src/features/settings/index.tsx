import { lazy, Suspense } from "react";
export * from "./hooks/useDocumentAppAppearance";
export { SettingsProfilesBridge } from "./profiles/SettingsProfilesBridge";
export type { SettingsSection } from "./settingsTypes";
export * from "./store/extensionTheme";
export { settingsBoolean } from "./store/preferences";
export * from "./store/useAppThemeStore";
export * from "./store/useSettingsStore";
const SettingsWorkspaceImplementation = lazy(() =>
  import("./SettingsPage").then((module) => ({
    default: module.SettingsWorkspace,
  })),
);
export type SettingsWorkspaceProps = {
  presentation?: "page" | "overlay";
  onClose?: () => void;
};
export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  return (
    <Suspense fallback={null}>
      <SettingsWorkspaceImplementation {...props} />
    </Suspense>
  );
}
export const SettingsPage = SettingsWorkspace;
