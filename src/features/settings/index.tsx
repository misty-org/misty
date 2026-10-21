import { lazy, Suspense } from "react";
import type * as SettingsPageModule from "./SettingsPage";
import { Skeleton, SkeletonList } from "@/shared/ui";
export * from "./components/DesktopSettingsUI";
export * from "./hooks/useDocumentAppAppearance";
export { SettingsProfilesBridge } from "./profiles/SettingsProfilesBridge";
export type { SettingsSection } from "./settingsTypes";
export * from "./store/appTheme";
export { settingsBoolean } from "./store/preferences";
export { PreferenceRow } from "./sections/PreferenceRow";
export * from "./store/useAppThemeStore";
export * from "./store/useSettingsStore";
let settingsPageModule: Promise<typeof SettingsPageModule> | null = null;
/** Fetches the settings page once. Opening settings then shows the page at once. */
export function preloadSettingsWorkspace(): Promise<typeof SettingsPageModule> {
  settingsPageModule ??= import("./SettingsPage");
  return settingsPageModule;
}
const SettingsWorkspaceImplementation = lazy(() =>
  preloadSettingsWorkspace().then((module) => ({
    default: module.SettingsWorkspace,
  })),
);
// The page is large; fetch it while the app is idle after startup rather than on the first open.
if (typeof window !== "undefined" && import.meta.env.MODE !== "test") {
  const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 2000));
  idle(() => void preloadSettingsWorkspace().catch(() => (settingsPageModule = null)), {
    timeout: 5000,
  });
}
export type SettingsWorkspaceProps = {
  presentation?: "page" | "overlay";
  onClose?: () => void;
};
export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  return (
    <Suspense fallback={<SettingsWorkspaceSkeleton overlay={props.presentation === "overlay"} />}>
      <SettingsWorkspaceImplementation {...props} />
    </Suspense>
  );
}
export { blockIfUnsaved, useSettingsProfiles } from "./profiles/store";
export { resolveSetting } from "./profiles/model";
export { browserSearchEngineStorageIndex } from "./browserSearchEngineSetting";

/** The settings window's shape (sidebar, then rows) while the page itself is still arriving. */
function SettingsWorkspaceSkeleton(props: { overlay: boolean }) {
  return (
    <div
      role="status"
      aria-label="Settings"
      aria-busy="true"
      className={`grid min-h-0 grid-cols-[248px_1px_minmax(0,1fr)] bg-charcoal-bg ${props.overlay ? "h-full" : "h-screen"}`}
    >
      <div className="grid content-start gap-2 bg-charcoal-sidebar p-3">
        <Skeleton className="h-8 w-full rounded-lg" />
        <SkeletonList label="Settings pages" rows={9} lines={1} className="mt-3" />
      </div>
      <div className="bg-charcoal-border" />
      <div className="grid content-start gap-4 px-10 pt-12">
        <Skeleton className="h-5 w-32" />
        <SkeletonList label="Settings" rows={5} leading="none" trailing />
      </div>
    </div>
  );
}
