import { openAccountSettingsInBrowser } from "@/features/account";
import { useAppStore } from "@/features/app-shell";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Input } from "@/shared/ui";
import { CircleUserRound, ExternalLink } from "lucide-react";
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
import { SettingsPageScope, SettingsScopePill } from "./profiles/SettingScope";
import { useSettingsProfiles } from "./profiles/store";
import { NativeAvailability } from "./sections/FeatureSections";
import {
  canonicalSettingsSection,
  settingsAreas,
  settingsPageTitle,
  settingsRegistry,
} from "./settingsRegistry";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";
import { useSettingsStore } from "./store/useSettingsStore";
export { canonicalSettingsSection, settingsRegistry } from "./settingsRegistry";
export type { SettingsArea, SettingsRegistryEntry } from "./settingsRegistry";
const navItems: DesktopSettingsNavEntry<SettingsSection>[] = settingsRegistry.map(
  (entry, index) => {
    const area = settingsAreas[entry.area];
    const multiPage = settingsRegistry.filter((item) => item.area === entry.area).length > 1;
    const firstOfArea = settingsRegistry[index - 1]?.area !== entry.area;
    return {
      id: entry.id,
      label: multiPage ? entry.label : area.label,
      icon: area.icon,
      parent: multiPage ? { id: entry.area, label: area.label, icon: area.icon } : undefined,
      breakBefore: firstOfArea && area.breakBefore,
    };
  },
);
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
        find("[data-setting-label]", "data-setting-label") ?? find("[aria-label]", "aria-label");
      if (!element) return;
      element.scrollIntoView?.({ block: "center" });
      (
        element.querySelector<HTMLElement>(
          "[data-setting-control] input:not(:disabled),[data-setting-control] button:not(:disabled),[data-setting-control] select:not(:disabled)",
        ) ?? element
      ).focus();
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
      openWithAssociations: state.openWithAssociations,
      shortcuts: state.shortcuts,
      working: state.working,
      error: state.error,
      setActiveSection: state.setActiveSection,
      updateSetting: state.updateSetting,
      load: state.load,
      removeOpenWithAssociation: state.removeOpenWithAssociation,
      updateShortcut: state.updateShortcut,
      reassignShortcut: state.reassignShortcut,
      resetShortcuts: state.resetShortcuts,
    })),
  );
  const navigate = useNavigate();
  const app = useAppStore((state) => state.app);
  const profile = useSettingsProfiles();
  const [query, setQuery] = useState("");
  const [linkError, setLinkError] = useState("");
  const [focus, setFocus] = useState({ label: "", request: 0 });
  const content = useFocusSettingRow(focus);
  const { settings, load } = store;
  const section = canonicalSettingsSection(store.activeSection);
  const entry = settingsRegistry.find((item) => item.id === section) ?? settingsRegistry[0];
  const results = useMemo(() => searchSettings(query), [query]);
  useEffect(() => {
    if (!settings) void load();
  }, [settings, load]);
  const select = (id: SettingsSection, label = "") => {
    store.setActiveSection(id);
    setFocus((current) => ({ label, request: current.request + 1 }));
    setQuery("");
  };
  const openResult = (result: SettingsSearchResult) => select(result.page, result.focus);
  const Active = entry.Component;
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
    onRemoveOpenWithAssociation: store.removeOpenWithAssociation,
    shortcuts: store.shortcuts,
    openWithAssociations: store.openWithAssociations,
    app,
  };
  return (
    <DesktopSettingsFrame
      activeId={entry.id}
      ariaLabel="Settings"
      items={navItems}
      navigationLabel="Settings sections"
      onClose={props.onClose}
      onSelect={(id) => select(id)}
      presentation={props.presentation}
      title={settingsPageTitle(entry)}
      titleAccessory={<SettingsScopePill owner={entry.owner} />}
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
      navigationFooter={
        <div className="mt-2 border-t border-charcoal-border/70 pt-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-xs text-cream-muted"
            aria-label="Account settings (opens in your browser)"
            onClick={() => {
              setLinkError("");
              void openAccountSettingsInBrowser().catch((e) => setLinkError(String(e)));
            }}
          >
            <CircleUserRound className="size-4" aria-hidden="true" />
            Account
            <ExternalLink className="ml-auto size-3" aria-hidden="true" />
          </Button>
          {linkError && (
            <p role="alert" className="text-xs text-destructive">
              {linkError}
            </p>
          )}
        </div>
      }
      contentHeader={
        <>
          {(store.error || profile.error) && (
            <div role="alert" className="mb-5 text-sm text-destructive">
              {store.error || profile.error}
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
          {profile.state?.notice && (
            <p role="status" className="mb-4 text-sm text-cream-muted">
              {profile.state.notice}
            </p>
          )}
        </>
      }
    >
      <div ref={content}>
        <SettingsPageScope.Provider value={{ page: entry.id, owner: entry.owner }}>
          {entry.native && !hasTauriInternals() ? (
            <NativeAvailability feature={entry.label} />
          ) : (
            <Active {...controls} />
          )}
        </SettingsPageScope.Provider>
      </div>
    </DesktopSettingsFrame>
  );
});
export default SettingsWorkspace;
export type { SettingsSection, SettingValue } from "./settingsTypes";
