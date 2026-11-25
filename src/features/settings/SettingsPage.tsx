import { useAppStore } from "@/app/shell";
import { Button, ErrorState, RowGroupStack, SearchField } from "@misty/ui";
import {
  memo,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  DesktopSettingsFrame,
  DesktopSettingsNotice,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection,
  TitledSettingsSection,
} from "./components/DesktopSettingsUI";
import { SettingsSaveBar } from "./components/SettingsSaveBar";
import type {
  DesktopSettingsNavGroup,
  DesktopSettingsPageSection,
} from "./components/SettingsNavigation";
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
  settingsPage,
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

const sameSections = (a: DesktopSettingsPageSection[], b: DesktopSettingsPageSection[]) =>
  a.length === b.length && a.every((item, index) => item.id === b[index]?.id);

function shownSections(root: HTMLElement): DesktopSettingsPageSection[] {
  return [...root.querySelectorAll<HTMLElement>("[data-settings-section]")]
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => ({
      id: element.dataset.settingsSection ?? "",
      label: element.dataset.settingsTitle ?? "",
    }));
}

function sectionElement(root: HTMLElement | null, id: string) {
  const sections = root?.querySelectorAll<HTMLElement>("[data-settings-section]") ?? [];
  return [...sections].find((element) => element.dataset.settingsSection === id) ?? null;
}

function usePageSections(
  content: RefObject<HTMLDivElement | null>,
  page: string,
  planned: DesktopSettingsPageSection[],
) {
  const [shown, setShown] = useState<{ page: string; sections: DesktopSettingsPageSection[] }>();
  const [reading, setReading] = useState("");
  useLayoutEffect(() => {
    const root = content.current;
    if (!root) return;
    const read = () => {
      const here = [...root.querySelectorAll<HTMLElement>("[data-settings-area]")].some(
        (element) => element.dataset.settingsArea === page && element.getClientRects().length > 0,
      );
      if (!here) return;
      const next = shownSections(root);
      setShown((current) =>
        current?.page === page && sameSections(current.sections, next)
          ? current
          : { page, sections: next },
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [content, page]);
  const sections = shown?.page === page ? shown.sections : planned;
  useLayoutEffect(() => {
    const root = content.current;
    const scroller = root?.closest<HTMLElement>("[data-settings-scroller]");
    if (!root || !scroller) return;
    const read = () => {
      const top = scroller.getBoundingClientRect().top + 36;
      let at = sections[0]?.id ?? "";
      for (const item of sections) {
        const element = sectionElement(root, item.id);
        if (element && element.getBoundingClientRect().top <= top) at = item.id;
      }
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2)
        at = sections.at(-1)?.id ?? at;
      setReading(at);
    };
    read();
    scroller.addEventListener("scroll", read, { passive: true });
    return () => scroller.removeEventListener("scroll", read);
  }, [content, sections]);
  return { sections, reading };
}

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
  const section = store.activeSection;
  const entry = settingsPage(section) ?? settingsRegistry[0];
  const focusTarget = store.focusTarget;
  const focus = useMemo(
    () =>
      focusTarget.label === `page:${section}` && entry.id !== section
        ? { ...focusTarget, label: `page:${entry.id}` }
        : focusTarget,
    [focusTarget, section, entry.id],
  );
  const content = useFocusSettingRow(focus);
  const { settings, load } = store;
  const pageEntries = useMemo(
    () => settingsRegistry.filter((item) => item.area === entry.area),
    [entry.area],
  );
  const results = useMemo(() => searchSettings(query), [query]);
  const planned = useMemo(
    () =>
      settingsRegistry.flatMap((item) =>
        item.area === entry.area && item.title ? [{ id: item.id, label: item.title }] : [],
      ),
    [entry.area],
  );
  const { sections, reading } = usePageSections(content, entry.area, planned);
  const jumpTo = (id: string) =>
    sectionElement(content.current, id)?.scrollIntoView({ block: "start" });

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
  const { onClose } = props;
  const settingsDocument = settings?.document;
  const working = store.working || !preferences.ready;
  const {
    launchOnLogin,
    updateSetting,
    updateShortcut,
    reassignShortcut,
    resetShortcuts,
    shortcuts,
    error: loadError,
  } = store;
  const controls = useMemo<SettingsContentProps>(
    () => ({
      document: settingsDocument ?? {},
      launchOnLogin,
      working,
      onSettingChange: updateSetting,
      onLoad: load,
      onOpenResource: (path) => {
        if (blockIfUnsaved()) return;
        onClose?.();
        navigate(path);
      },
      onShortcutChange: updateShortcut,
      onShortcutReassign: reassignShortcut,
      onResetShortcuts: resetShortcuts,
      shortcuts,
      app,
    }),
    [
      settingsDocument,
      launchOnLogin,
      working,
      updateSetting,
      load,
      onClose,
      navigate,
      updateShortcut,
      reassignShortcut,
      resetShortcuts,
      shortcuts,
      app,
    ],
  );
  const pageTitle = settingsAreas[entry.area].label;
  const error = (settings ? store.error : null) || preferences.error;
  const page = useMemo(() => {
    const loading = (
      <DesktopSettingsSection title={pageTitle} section="loading">
        <DesktopSettingsRowSkeleton label={pageTitle} rows={4} control="switch" />
      </DesktopSettingsSection>
    );
    return (
      <RowGroupStack ref={content}>
        {settings ? null : loadError ? (
          <ErrorState
            inline
            title="Settings couldn't load"
            line="Something went wrong on this computer. Try again in a moment."
            action={{ label: "Try again", onClick: () => void load() }}
          />
        ) : (
          loading
        )}
        {settings && (
          <Suspense fallback={loading}>
            {pageEntries.map((item) => {
              const Block = item.Component;
              const body = (
                <SettingsPageScope.Provider value={{ page: item.id, owner: item.owner }}>
                  <Block {...controls} />
                </SettingsPageScope.Provider>
              );
              const marks = {
                "data-settings-page": item.id,
                "data-settings-area": item.area,
                "data-settings-target": `page:${item.id}`,
                "data-tour": item.tour,
                tabIndex: -1,
              };
              return item.title ? (
                <TitledSettingsSection
                  key={item.id}
                  title={item.title}
                  section={item.id}
                  {...marks}
                >
                  {body}
                </TitledSettingsSection>
              ) : (
                <RowGroupStack key={item.id} {...marks} className="outline-none">
                  {body}
                </RowGroupStack>
              );
            })}
          </Suspense>
        )}
      </RowGroupStack>
    );
  }, [content, settings, loadError, load, pageTitle, pageEntries, controls]);

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
      onSelect={(id) => select(id)}
      sections={settings && sections.length > 1 ? sections : undefined}
      activeSection={sections.length > 1 ? reading : undefined}
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
      {page}
    </DesktopSettingsFrame>
  );
});

export default SettingsWorkspace;
