import { useAppStore } from "@/app/shell";
import { Button, ErrorState, SearchField } from "@misty/ui";
import { memo, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  DesktopSettingsFrame,
  DesktopSettingsNotice,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection,
} from "./components/DesktopSettingsUI";
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
import { settingsErrorMessage } from "./settings_errors";
import {
  settingsAreaEntry,
  settingsAreas,
  settingsGroups,
  settingsRegistry,
} from "./SettingsRegistry";
import type { SettingsContentProps, SettingsSection } from "./settings_types";
import { useSettingsStore } from "./preferences/use_settings_store";
import { useFocusSettingRow } from "./use_focus_setting_row";

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
  const section = store.activeSection;
  const entry = settingsRegistry.find((item) => item.id === section) ?? settingsRegistry[0];
  const pageEntries = settingsRegistry.filter((item) => item.area === entry.area);
  const results = useMemo(() => searchSettings(query), [query]);
  const [jumped, setJumped] = useState("");
  const jumpTo = (id: string) => {
    setJumped(id);
    content.current
      ?.querySelector(`[data-settings-page="${id}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  useEffect(() => setJumped(""), [entry.area]);

  useEffect(() => {
    if (!settings) void load();
  }, [settings, load]);
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
    document: settings?.document ?? {},
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
  const pageTitle = settingsAreas[entry.area].label;
  const error = (settings ? store.error : null) || preferences.error;

  return (
    <DesktopSettingsFrame
      activeId={pageEntries[0].id}
      ariaLabel="Settings"
      groups={navGroups()}
      navigationLabel="Settings sections"
      navigationTour="settings-nav"
      onClose={() => {
        if (!blockIfUnsaved()) props.onClose?.();
      }}
      saveBar={<SettingsSaveBar />}
      onSelect={(id) => {
        setJumped("");
        select(id);
      }}
      sections={
        settings && pageEntries.length > 4
          ? pageEntries.map((item) => ({ id: item.id, label: item.label }))
          : undefined
      }
      activeSection={jumped || undefined}
      onSection={jumpTo}
      presentation={props.presentation}
      title={pageTitle}
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
        {settings ? null : store.error ? (
          <ErrorState
            inline
            title="Settings couldn't load"
            line="Something went wrong on this computer. Try again in a moment."
            action={{ label: "Try again", onClick: () => void load() }}
          />
        ) : (
          <DesktopSettingsSection title={pageTitle}>
            <DesktopSettingsRowSkeleton label={pageTitle} rows={4} control="switch" />
          </DesktopSettingsSection>
        )}
        {settings && (
          <Suspense
            fallback={
              <DesktopSettingsSection title={pageTitle}>
                <DesktopSettingsRowSkeleton label={pageTitle} rows={4} control="switch" />
              </DesktopSettingsSection>
            }
          >
            {pageEntries.map((item) => {
              const Block = item.Component;
              return (
                <div
                  key={item.id}
                  data-settings-page={item.id}
                  data-settings-target={`page:${item.id}`}
                  tabIndex={-1}
                  className="mb-5 outline-none last:mb-0"
                >
                  <SettingsPageScope.Provider value={{ page: item.id, owner: item.owner }}>
                    <Block {...controls} />
                  </SettingsPageScope.Provider>
                </div>
              );
            })}
          </Suspense>
        )}
      </div>
    </DesktopSettingsFrame>
  );
});

export default SettingsWorkspace;
