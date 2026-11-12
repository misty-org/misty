import { useAppStore } from "@/app/shell";
import { Button, SearchField } from "@/shared/ui";
import { memo, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { DesktopSettingsFrame, DesktopSettingsNotice } from "./components/DesktopSettingsUI";
import { SettingsSaveBar } from "./components/SettingsSaveBar";
import type { DesktopSettingsNavGroup } from "./components/SettingsNavigation";
import {
  searchSettings,
  SettingsSearchResults,
  type SettingsSearchResult,
} from "./components/SettingsSearchResults";
import { SettingsPageScope } from "./device-preferences/SettingScope";
import {
  blockIfUnsaved,
  setSettingsStaging,
  useDevicePreferences,
} from "./device-preferences/store";
import { settingsErrorMessage } from "./settingsErrors";
import {
  canonicalSettingsSection,
  settingsAreaEntry,
  settingsAreas,
  settingsGroups,
  settingsRegistry,
} from "./settingsRegistry";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";
import { useSettingsStore } from "./preferences/useSettingsStore";
import { useFocusSettingRow } from "./useFocusSettingRow";

// Read when the page renders, after the app has registered the feature sections.
const navGroups = (): DesktopSettingsNavGroup<SettingsSection>[] =>
  settingsGroups.map((group) => ({
    label: group.label,
    items: group.areas.flatMap((area) => {
      const first = settingsAreaEntry(area);
      return first
        ? [{ id: first.id, label: settingsAreas[area].label, icon: settingsAreas[area].icon }]
        : [];
    }),
  }));

interface SettingsWorkspaceProps {
  presentation?: "page" | "overlay";
  onClose?: () => void;
}

/** Settings: a sidebar of pages under feature groups, and one scrolling page per entry. */
export const SettingsWorkspace = memo(function SettingsWorkspace(props: SettingsWorkspaceProps) {
  const store = useSettingsStore(
    useShallow((state) => ({
      activeSection: state.activeSection,
      focusTarget: state.focusTarget,
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
  const navigate = useNavigate();
  const app = useAppStore((state) => state.app);
  const preferences = useDevicePreferences(
    useShallow((state) => ({ ready: state.ready, error: state.error, refresh: state.refresh })),
  );
  const [query, setQuery] = useState("");
  const content = useFocusSettingRow(store.focusTarget);
  const { settings, load } = store;
  const section = canonicalSettingsSection(store.activeSection);
  const entry = settingsRegistry.find((item) => item.id === section) ?? settingsRegistry[0];
  const pageEntries = settingsRegistry.filter((item) => item.area === entry.area);
  const results = useMemo(() => searchSettings(query), [query]);

  useEffect(() => {
    if (!settings) void load();
  }, [settings, load]);
  // While this page is open, edits wait for Save changes; closing it drops anything unsaved.
  useEffect(() => {
    setSettingsStaging(true);
    return () => setSettingsStaging(false);
  }, []);

  const select = (id: SettingsSection, focus?: string) => {
    store.setActiveSection(id, focus);
    setQuery("");
  };
  const openResult = (result: SettingsSearchResult) => select(result.page, result.focus);
  const controls: SettingsContentProps = {
    document: store.settings?.document ?? {},
    launchOnLogin: store.launchOnLogin,
    working: store.working || !preferences.ready,
    onSettingChange: store.updateSetting,
    onLoad: store.load,
    onOpenResource: (path) => {
      if (blockIfUnsaved()) return;
      props.onClose?.();
      navigate(path);
    },
    onShortcutChange: store.updateShortcut,
    onShortcutReassign: store.reassignShortcut,
    onResetShortcuts: store.resetShortcuts,
    shortcuts: store.shortcuts,
    app,
  };
  const error = store.error || preferences.error;

  return (
    <DesktopSettingsFrame
      activeId={pageEntries[0].id}
      ariaLabel="Settings"
      groups={navGroups()}
      navigationLabel="Settings sections"
      onClose={() => {
        if (!blockIfUnsaved()) props.onClose?.();
      }}
      saveBar={<SettingsSaveBar />}
      onSelect={(id) => select(id)}
      presentation={props.presentation}
      title={settingsAreas[entry.area].label}
      navigationHeader={
        <SearchField
          aria-label="Search settings"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) openResult(results[0]);
          }}
        />
      }
      navigationOverride={
        query.trim() ? (
          <SettingsSearchResults query={query} results={results} onSelect={openResult} />
        ) : undefined
      }
      contentHeader={
        error ? (
          <DesktopSettingsNotice
            action={
              <Button
                variant="quiet"
                onClick={() =>
                  void (preferences.ready ? preferences.refresh() : store.load()).catch(() => {})
                }
              >
                Retry
              </Button>
            }
          >
            {settingsErrorMessage(error)}
          </DesktopSettingsNotice>
        ) : null
      }
    >
      <div ref={content}>
        {pageEntries.map((item) => {
          const Block = item.Component;
          return (
            <div
              key={item.id}
              data-settings-page={item.id}
              data-settings-target={`page:${item.id}`}
              tabIndex={-1}
              className="mb-8 outline-none last:mb-0"
            >
              <SettingsPageScope.Provider value={{ page: item.id, owner: item.owner }}>
                <Block {...controls} />
              </SettingsPageScope.Provider>
            </div>
          );
        })}
      </div>
    </DesktopSettingsFrame>
  );
});

export default SettingsWorkspace;
