import { useAppStore } from "@/features/app-shell";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { DesktopSettingsFrame, DesktopSettingsNotice } from "./components/DesktopSettingsUI";
import type { DesktopSettingsNavGroup } from "./components/SettingsNavigation";
import { SettingsPageScope } from "./devicePreferences/SettingScope";
import { blockIfUnsaved } from "./devicePreferences/store";
import { settingsErrorMessage } from "./settingsErrors";
import {
  canonicalSettingsSection,
  settingsAreaEntry,
  settingsAreas,
  settingsGroups,
  settingsRegistry,
} from "./settingsRegistry";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";
import { useSettingsStore } from "./store/useSettingsStore";

export { canonicalSettingsSection, settingsRegistry };
export type { SettingsArea, SettingsRegistryEntry } from "./settingsRegistry";

export interface SettingsWorkspaceProps {
  presentation?: "page" | "overlay";
  onClose?: () => void;
}

const navGroups: DesktopSettingsNavGroup<SettingsSection>[] = settingsGroups.map((group) => ({
  label: group.label,
  items: group.areas.flatMap((area) => {
    const entry = settingsAreaEntry(area);
    if (!entry) return [];
    const info = settingsAreas[area];
    return [{ id: entry.id, label: info.label, icon: info.icon }];
  }),
}));

/** The settings pages registered in settingsRegistry; the rest of the surface is being rebuilt. */
export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  const store = useSettingsStore(
    useShallow((state) => ({
      activeSection: state.activeSection,
      settings: state.settings,
      launchOnLogin: state.launchOnLogin,
      shortcuts: state.shortcuts,
      working: state.working,
      error: state.error,
      setActiveSection: state.setActiveSection,
      updateSetting: state.updateSetting,
      load: state.load,
      updateShortcut: state.updateShortcut,
      reassignShortcut: state.reassignShortcut,
      resetShortcuts: state.resetShortcuts,
    })),
  );
  const app = useAppStore((state) => state.app);
  const { settings, load } = store;
  useEffect(() => {
    if (!settings) void load();
  }, [settings, load]);
  const section = canonicalSettingsSection(store.activeSection);
  const entry = settingsRegistry.find((item) => item.id === section) ?? settingsRegistry[0];
  const controls: SettingsContentProps = {
    document: settings?.document ?? {},
    launchOnLogin: store.launchOnLogin,
    working: store.working,
    onSettingChange: store.updateSetting,
    onLoad: store.load,
    onShortcutChange: store.updateShortcut,
    onShortcutReassign: store.reassignShortcut,
    onResetShortcuts: store.resetShortcuts,
    shortcuts: store.shortcuts,
    app,
  };
  const Page = entry?.Component;
  return (
    <DesktopSettingsFrame
      activeId={entry?.id ?? section}
      ariaLabel="Settings"
      groups={navGroups}
      navigationLabel="Settings sections"
      onClose={() => {
        if (!blockIfUnsaved()) props.onClose?.();
      }}
      onSelect={(id) => store.setActiveSection(id)}
      presentation={props.presentation}
      title={entry ? settingsAreas[entry.area].label : "Settings"}
      contentHeader={
        store.error ? (
          <DesktopSettingsNotice>{settingsErrorMessage(store.error)}</DesktopSettingsNotice>
        ) : null
      }
    >
      {entry && Page ? (
        <div data-settings-page={entry.id}>
          <SettingsPageScope.Provider value={{ page: entry.id, owner: entry.owner }}>
            <Page {...controls} />
          </SettingsPageScope.Provider>
        </div>
      ) : null}
    </DesktopSettingsFrame>
  );
}

export default SettingsWorkspace;
export type { SettingsSection } from "./settingsTypes";
