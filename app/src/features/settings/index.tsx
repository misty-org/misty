import { lazy, Suspense } from "react";

export * from "./components/DesktopSettingsUI";
export * from "./hooks/useDocumentAppAppearance";
export * from "./store/useAppThemeStore";
export * from "./store/useSettingsStore";
export type { SettingsSection } from "./settingsTypes";

const SettingsWorkspaceImplementation = lazy(() =>
  import("./SettingsPage").then((module) => ({ default: module.SettingsWorkspace })),
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
