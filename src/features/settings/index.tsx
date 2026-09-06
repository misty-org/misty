import { lazy, Suspense } from "react";

export * from "./hooks/useDocumentAppAppearance";
export * from "./store/extensionTheme";
export * from "./store/useAppThemeStore";
export * from "./store/useSettingsStore";
export { settingsBoolean } from "./store/preferences";
export type { SettingsSection } from "./settingsTypes";

const SettingsWorkspaceImplementation = lazy(() =>
  import("./SettingsPage").then((module) => ({ default: module.SettingsWorkspace })),
);

export type SettingsWorkspaceProps = {
  presentation?: "page" | "overlay" | "mobile";
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
