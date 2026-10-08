import { useAppStore } from "@/features/app-shell";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Input } from "@/shared/ui";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { DesktopSettingsFrame } from "./components/DesktopSettingsUI";
import type { DesktopSettingsNavEntry } from "./components/SettingsNavigation";
import {
  searchSettings,
  SettingsSearchResults,
  type SettingsSearchResult,
} from "./components/SettingsSearchResults";
import { SettingsPageScope } from "./profiles/SettingScope";
import { useSettingsProfiles } from "./profiles/store";
import { NativeAvailability } from "./sections/FeatureSections";
import { canonicalSettingsSection, settingsAreas, settingsRegistry } from "./settingsRegistry";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";
import { useSettingsStore } from "./store/useSettingsStore";
export { canonicalSettingsSection, settingsRegistry } from "./settingsRegistry";
export type { SettingsArea, SettingsRegistryEntry } from "./settingsRegistry";
const navItems: DesktopSettingsNavEntry<SettingsSection>[] = settingsRegistry
  .filter(
    (entry, index) => settingsRegistry.findIndex((item) => item.area === entry.area) === index,
  )
  .map((entry) => ({
    id: entry.id,
    hasSections: settingsRegistry.filter((item) => item.area === entry.area).length > 1,
    ...settingsAreas[entry.area],
  }));
/** Scrolls to, focuses, and briefly highlights the row a search result pointed at. */
function useFocusSettingRow(focus: { label: string; request: number }) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus.label) return;
    let clearFlash: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      const find = (selector: string, attribute: string) =>
        Array.from(content.current?.querySelectorAll<HTMLElement>(selector) ?? []).find(
          (e) => e.getAttribute(attribute) === focus.label,
        );
      const element =
        find("[data-setting-label]", "data-setting-label") ??
        find("[aria-label]", "aria-label") ??
        find("[data-settings-target]", "data-settings-target");
      if (!element) return;
      const wholePage = focus.label.startsWith("page:");
      element.scrollIntoView?.({ block: wholePage ? "start" : "center" });
      const target = wholePage
        ? element
        : (element.querySelector<HTMLElement>(
            "[data-setting-control] input:not(:disabled),[data-setting-control] button:not(:disabled),[data-setting-control] select:not(:disabled)",
          ) ?? element);
      target.focus({ preventScroll: true });
      element.dataset.settingFlash = "true";
      clearFlash = setTimeout(() => delete element.dataset.settingFlash, 900);
    }, 0);
    return () => {
      clearTimeout(timer);
      clearTimeout(clearFlash);
    };
  }, [focus]);
  return content;
}
export const SettingsWorkspace = memo(function SettingsWorkspace(props: {
  presentation?: "page" | "overlay";
  onClose?: () => void;
}) {
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
  const navigate = useNavigate();
  const app = useAppStore((state) => state.app);
  const profile = useSettingsProfiles();
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState({ label: "", request: 0 });
  const content = useFocusSettingRow(focus);
  const { settings, load } = store;
  const section = canonicalSettingsSection(store.activeSection);
  const entry = settingsRegistry.find((item) => item.id === section) ?? settingsRegistry[0];
  const results = useMemo(() => searchSettings(query), [query]);
  useEffect(() => {
    if (!settings) void load();
  }, [settings, load]);
  const select = (id: SettingsSection, label = `page:${id}`) => {
    store.setActiveSection(id);
    setFocus((current) => ({ label, request: current.request + 1 }));
    setQuery("");
  };
  const openResult = (result: SettingsSearchResult) =>
    select(result.page, result.focus || `page:${result.page}`);
  const areaEntries = settingsRegistry.filter((item) => item.area === entry.area);
  const controls: SettingsContentProps = {
    document: store.settings?.document ?? {},
    launchOnLogin: store.launchOnLogin,
    working: store.working || !profile.ready,
    onSettingChange: store.updateSetting,
    onLoad: store.load,
    onOpenResource: (path) => {
      props.onClose?.();
      navigate(path);
    },
    onShortcutChange: store.updateShortcut,
    onShortcutReassign: store.reassignShortcut,
    onResetShortcuts: store.resetShortcuts,
    shortcuts: store.shortcuts,
    app,
  };
  return (
    <DesktopSettingsFrame
      activeId={areaEntries[0].id}
      ariaLabel="Settings"
      items={navItems}
      navigationLabel="Settings sections"
      onClose={props.onClose}
      onSelect={(id) => select(id)}
      presentation={props.presentation}
      title={settingsAreas[entry.area].label}
      navigationHeader={
        <Input
          aria-label="Search settings"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
            if (e.key === "Enter" && results[0]) openResult(results[0]);
          }}
        />
      }
      navigationOverride={
        query.trim() ? (
          <SettingsSearchResults query={query} results={results} onSelect={openResult} />
        ) : undefined
      }
      contentHeader={
        <>
          {(store.error || (entry.area !== "sync" && profile.error)) && (
            <div role="alert" className="mb-5 text-sm text-cream">
              {store.error || (entry.area !== "sync" && profile.error)}
              <Button
                variant="ghost"
                onClick={() =>
                  void (
                    profile.ready
                      ? profile.refresh()
                      : store
                          .load()
                          .then(() => window.dispatchEvent(new Event("misty:retry-settings")))
                  ).catch(() => {})
                }
              >
                Retry
              </Button>
            </div>
          )}
        </>
      }
    >
      <div ref={content}>
        {areaEntries.map((item) => {
          const Active = item.Component;
          return (
            <div
              key={item.id}
              data-settings-page={item.id}
              data-settings-target={`page:${item.id}`}
              tabIndex={-1}
              className="mb-6 last:mb-0"
            >
              <SettingsPageScope.Provider value={{ page: item.id, owner: item.owner }}>
                {item.native && !hasTauriInternals() ? (
                  <NativeAvailability feature={item.label} />
                ) : (
                  <Active {...controls} />
                )}
              </SettingsPageScope.Provider>
            </div>
          );
        })}
      </div>
    </DesktopSettingsFrame>
  );
});
export default SettingsWorkspace;
export type { SettingsSection, SettingValue } from "./settingsTypes";
