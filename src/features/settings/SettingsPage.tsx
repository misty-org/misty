import { openAccountSettingsInBrowser } from "@/features/account";
import { useAppStore } from "@/features/app-shell";
import { BrowserSyncSettings } from "@/features/browser-workspace/BrowserSyncSettings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Input } from "@/shared/ui";
import { Bot, ExternalLink, Folder, Globe, Layers, Settings2, type LucideIcon } from "lucide-react";
import { memo, useEffect, useRef, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { DesktopSettingsFrame } from "./components/DesktopSettingsUI";
import { ProfileSelector, ProfilesSection, SyncSection } from "./profiles/ProfileControls";
import { settingSearchEntries, type SettingOwnership } from "./profiles/registry";
import { SettingsPageScope } from "./profiles/SettingScope";
import { useSettingsProfiles } from "./profiles/store";
import { AdvancedSection } from "./sections/AdvancedSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { BrowserPermissionSettings } from "./sections/BrowserPermissionSettings";
import { BrowserSection } from "./sections/BrowserSection";
import {
  AboutSection,
  AgentConnectionsSection,
  AgentDefaultsSection,
  AgentPermissionsSection,
  CompanionSection,
  DevicesSection,
  FileConnectionsSection,
  ManageSpacesSection,
  ModelsSection,
  NativeAvailability,
  SpaceAgendaSection,
  SpaceDefaultsSection,
} from "./sections/FeatureSections";
import { FilesSection } from "./sections/FilesSection";
import { GeneralSection } from "./sections/GeneralSection";
import { LayoutSection } from "./sections/LayoutSection";
import { MistySection } from "./sections/MistySection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { PrivacySection } from "./sections/PrivacySection";
import { SearchSection } from "./sections/SearchSection";
import { ServerSection } from "./sections/ServerSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { TransfersSection } from "./sections/TransfersSection";
import { UpdatesSection } from "./sections/UpdatesSection";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";
import { useSettingsStore } from "./store/useSettingsStore";
export type SettingsGroup = "app" | "browser" | "spaces" | "files" | "agents";
const groups: Record<
  SettingsGroup,
  {
    label: string;
    icon: LucideIcon;
  }
> = {
  app: {
    label: "App",
    icon: Settings2,
  },
  browser: {
    label: "Browser",
    icon: Globe,
  },
  spaces: {
    label: "Spaces",
    icon: Layers,
  },
  files: {
    label: "Files",
    icon: Folder,
  },
  agents: {
    label: "Agents",
    icon: Bot,
  },
};
export interface SettingsRegistryEntry {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: SettingsGroup;
  Component: ComponentType<SettingsContentProps>;
  owner: SettingOwnership;
  native?: boolean;
}
const page = (
  group: SettingsGroup,
  id: SettingsSection,
  label: string,
  Component: ComponentType<SettingsContentProps>,
  owner: SettingsRegistryEntry["owner"] = "profile",
  native = false,
): SettingsRegistryEntry => ({
  group,
  id,
  label,
  Component,
  owner,
  native,
  icon: groups[group].icon,
});
export const settingsRegistry: readonly SettingsRegistryEntry[] = [
  page("app", "general", "General", GeneralSection),
  page("app", "appearance", "Appearance", AppearanceSection),
  page("app", "layout", "Layout", LayoutSection, "resource", true),
  page("app", "notifications", "Notifications", NotificationsSection),
  page("app", "shortcuts", "Shortcuts", ShortcutsSection, "device", true),
  page("app", "profiles", "Profiles", ProfilesSection),
  page("app", "sync", "Sync", SyncSection),
  page("app", "server", "Server", ServerSection, "device", true),
  page("app", "devices", "Devices", DevicesSection, "device"),
  page("app", "privacy", "Privacy", PrivacySection, "device"),
  page("app", "updates", "Updates", UpdatesSection, "device", true),
  page("app", "about", "About", AboutSection, "device"),
  page("app", "diagnostics", "Diagnostics", AdvancedSection, "device", true),
  page("browser", "browser", "Browsing", BrowserSection),
  page(
    "browser",
    "browser-downloads",
    "Downloads",
    (p) => <BrowserSection {...p} page="downloads" />,
    "profile",
  ),
  page(
    "browser",
    "browser-privacy",
    "Privacy",
    (p) => <PrivacySection {...p} page="browser" />,
    "device",
  ),
  page(
    "browser",
    "browser-permissions",
    "Permissions",
    BrowserPermissionSettings,
    "resource",
    true,
  ),
  page("browser", "browser-handoff", "Device Handoff", BrowserSyncSettings, "resource"),
  page("spaces", "spaces-defaults", "Defaults", SpaceDefaultsSection),
  page("spaces", "spaces-agenda", "Agenda", SpaceAgendaSection),
  page("spaces", "spaces-manage", "Manage Spaces", ManageSpacesSection, "resource"),
  page("files", "files", "Browsing", FilesSection),
  page(
    "files",
    "files-locations",
    "Locations",
    (p) => <FilesSection {...p} page="locations" />,
    "device",
    true,
  ),
  page("files", "files-connections", "Connections", FileConnectionsSection, "resource"),
  page("files", "search", "Search", (p) => <SearchSection {...p} page="search" />, "device", true),
  page(
    "files",
    "files-indexing",
    "Indexing",
    (p) => <SearchSection {...p} page="indexing" />,
    "device",
    true,
  ),
  page("files", "transfers", "Transfers", TransfersSection, "device"),
  page("agents", "models", "Models", ModelsSection, "account"),
  page("agents", "agents-defaults", "Defaults", AgentDefaultsSection),
  page("agents", "misty", "Misty", MistySection, "account"),
  page(
    "agents",
    "agents-memory",
    "Memory",
    (p) => <MistySection {...p} page="memory" />,
    "account",
  ),
  page("agents", "agents-connections", "Connections", AgentConnectionsSection, "resource"),
  page("agents", "agents-permissions", "Permissions", AgentPermissionsSection, "resource"),
  page("agents", "agents-companion", "Companion", CompanionSection, "device"),
];
export function canonicalSettingsSection(section: SettingsSection): SettingsSection {
  return (
    (
      {
        advanced: "diagnostics",
        agents: "agents-defaults",
        support: "about",
        account: "general",
        inbox: "notifications",
        social: "spaces-defaults",
        journal: "spaces-defaults",
        planner: "spaces-agenda",
        library: "spaces-manage",
        terminal: "general",
        code: "general",
      } as Partial<Record<SettingsSection, SettingsSection>>
    )[section] ?? section
  );
}
const navItems = settingsRegistry.map(({ id, label, icon, group }) => ({
  id,
  label,
  icon,
  group,
  groupLabel: groups[group].label,
  groupIcon: groups[group].icon,
}));
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
  const [query, setQuery] = useState(""),
    [linkError, setLinkError] = useState(""),
    [focusLabel, setFocusLabel] = useState("");
  const [navigationRequest, setNavigationRequest] = useState(0);
  const { settings, load } = store;
  const content = useRef<HTMLDivElement>(null);
  const section = canonicalSettingsSection(store.activeSection);
  const entry = settingsRegistry.find((item) => item.id === section) ?? settingsRegistry[0];
  useEffect(() => {
    if (!settings) void load();
  }, [settings, load]);
  useEffect(() => {
    if (!focusLabel) return;
    const timer = setTimeout(() => {
      const row = Array.from(
        content.current?.querySelectorAll<HTMLElement>("[data-setting-label]") ?? [],
      ).find((e) => e.dataset.settingLabel === focusLabel);
      const element =
        row ??
        Array.from(content.current?.querySelectorAll<HTMLElement>("[aria-label]") ?? []).find(
          (e) => e.getAttribute("aria-label") === focusLabel,
        );
      if (element) {
        element.scrollIntoView?.({
          block: "center",
        });
        (
          element.querySelector<HTMLElement>(
            "[data-setting-control] input:not(:disabled),[data-setting-control] button:not(:disabled),[data-setting-control] select:not(:disabled)",
          ) ?? element
        ).focus();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [focusLabel, entry.id, navigationRequest]);
  const select = (id: SettingsSection, label = "") => {
    setNavigationRequest((request) => request + 1);
    store.setActiveSection(id);
    setFocusLabel(label);
    setQuery("");
  };
  const matches = query.trim()
    ? settingSearchEntries.filter((d) =>
        `${d.label} ${d.id} ${d.page} ${d.keywords?.join(" ") ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : [];
  const matchingPages = query.trim()
    ? settingsRegistry.filter((p) =>
        `${groups[p.group].label} ${p.label}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : [];
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
      onSelect={select}
      presentation={props.presentation}
      title={`${groups[entry.group].label} / ${entry.label}`}
      navigationHeader={
        <>
          <ProfileSelector />
          <Input
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <div aria-label="Settings search results" className="grid gap-1">
              {matches.map((d) => (
                <Button
                  variant="ghost"
                  type="button"
                  key={d.id}
                  className="h-auto flex-col items-start whitespace-normal rounded px-2 py-2 text-left text-xs"
                  onClick={() => select(d.page as SettingsSection, d.label)}
                >
                  {d.label}
                  <span className="block text-cream-muted">
                    {groups[settingsRegistry.find((p) => p.id === d.page)!.group].label} /{" "}
                    {settingsRegistry.find((p) => p.id === d.page)!.label}
                  </span>
                </Button>
              ))}
              {matchingPages.map((p) => (
                <Button
                  variant="ghost"
                  type="button"
                  key={p.id}
                  className="px-2 py-2 text-left text-xs hover:bg-charcoal-hover"
                  onClick={() => select(p.id)}
                >
                  {groups[p.group].label} / {p.label}
                </Button>
              ))}
              {!matches.length && !matchingPages.length && (
                <p className="text-xs text-cream-muted">No matching settings.</p>
              )}
            </div>
          )}
        </>
      }
      navigationFooter={
        <div className="mt-5 border-t border-charcoal-border pt-3">
          <Button
            variant="ghost"
            className="w-full justify-start text-xs"
            onClick={() => {
              setLinkError("");
              void openAccountSettingsInBrowser().catch((e) => setLinkError(String(e)));
            }}
          >
            Account settings <ExternalLink className="ml-auto size-3" />
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
        <SettingsPageScope.Provider
          value={{
            page: entry.id,
            owner: entry.owner,
          }}
        >
          {entry.owner !== "profile" && (
            <p className="mb-4 text-xs text-cream-muted">
              {entry.owner === "account"
                ? "Scope: Account"
                : entry.owner === "resource"
                  ? "Scope: Individual resources"
                  : "Scope: This device"}
            </p>
          )}
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
