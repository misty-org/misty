import type { SettingsSection, SettingValue } from "@/models/types/pages/Settings/desktop/index";
export type { SettingsSection, SettingValue } from "@/models/types/pages/Settings/desktop/index";
import type {
  NavItem,
  SettingsContentProps,
} from "@/models/interfaces/pages/Settings/desktop/index";
export type {
  NavItem,
  SettingsContentProps,
} from "@/models/interfaces/pages/Settings/desktop/index";
import { memo, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import { Badge } from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Switch } from "@/ui";
import { Slider } from "@/ui";
import { Spinner } from "@/ui";
import {
  AppWindow,
  ArrowLeftRight,
  Bell,
  Bot,
  Cloud,
  Copy,
  Eye,
  FolderOpen,
  HardDrive,
  Image,
  Keyboard,
  Lock,
  Rows3,
  Search,
  Settings2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { InstallerCard } from "../../../features/installer/InstallerCard";
import { useAppStore } from "@/stores/app";
import { settingsIndexToThemeMode, themeModeToSettingsIndex, useAppThemeStore } from "@/stores/app";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  SearchStatus,
  ShortcutBinding,
} from "@/models/interfaces/services/misty-api";
import { selectAssistantPreferences, useSettingsStore } from "@/stores/app";
import { useSearchStore } from "@/stores/explorer";
import { formatDate } from "@/features/explorer/utils/fileFormat";
import { userFacingErrorText } from "@/lib/format";
import { hasTauriInternals } from "@/platform/tauri";
import { isAndroidBuild } from "@/platform/buildTarget";
import {
  defaultTransferProfileId,
  transferProfileRecords,
  transferProfileSettingsPayload,
} from "../transferProfiles";
import type { TransferProfileRecord } from "@/models/interfaces/pages/Settings/transferProfiles";
import {
  DesktopSettingsFrame,
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../DesktopSettingsUI";

const appNavItems: NavItem[] = [
  { id: "general", label: "General", icon: Rows3 },
  { id: "app", label: "App", icon: AppWindow },
  { id: "assistant", label: "Agents", icon: Bot },
  { id: "appearance", label: "Appearance", icon: Eye },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "transfers", label: "Transfers", icon: ArrowLeftRight },
  { id: "search", label: "Search & Library", icon: Search },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "advanced", label: "Advanced", icon: Settings2 },
];

const navItems = appNavItems;

const sectionDescriptions: Record<SettingsSection, string> = {
  general: "Files startup, default actions, and browsing behavior.",
  app: "Updates, version details, and local support information.",
  assistant: "Control Agents and the actions they can perform.",
  appearance: "Theme, density, wallpaper, text size, and motion.",
  privacy: "Choose what diagnostic data Misty may share.",
  transfers: "Defaults for copies, downloads, and destinations.",
  search: "Keep filenames and connected libraries searchable.",
  notifications: "Choose which activity should interrupt you.",
  shortcuts: "Review and customize keyboard commands.",
  advanced: "Runtime, developer, and recovery preferences.",
};

const defaultFileActionOptions = ["Open", "Preview", "Show Details"];
const transferBehaviorOptions = ["Ask Every Time", "Use Default Location"];
const themeOptions = ["System", "Dark", "Light"];
const scaleOptions = ["Small", "Default", "Large"];
const keymapOptions = ["System", "VS Code", "Finder"];

const settingsControlButtonClass = "w-[220px] max-w-full gap-1.5";

const settingsControlButtonCompactClass = "min-w-24 gap-1.5";

const settingsPrimaryButtonClass = "min-w-32";

const settingsReferenceListClass = "grid min-w-0";

const settingsReferenceRowClass =
  "grid min-h-[54px] grid-cols-[minmax(0,0.52fr)_minmax(220px,0.48fr)] items-center gap-[18px] border-b border-border/60 px-5 py-2 text-sm text-foreground";

const settingsReferenceHeaderClass =
  "min-h-10 bg-muted/40 text-xs font-medium text-muted-foreground";

const settingsReferenceSpanClass = "min-w-0 [overflow-wrap:anywhere]";

const settingsIconDangerClass =
  "size-[30px] border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive";

const settingsInlineActionsClass = "flex items-center gap-3 px-5 py-4";

const settingsEmptyClass = "px-5 py-4 text-sm text-muted-foreground";

const settingsAssociationRowClass =
  "grid min-h-[54px] grid-cols-[minmax(110px,0.22fr)_minmax(0,1fr)_32px] items-center gap-[18px] border-b border-border/60 px-5 py-2 text-sm text-foreground";

export const SettingsWorkspace = memo(function SettingsWorkspace(props: {
  presentation?: "page" | "overlay";
  onClose?: () => void;
}) {
  const {
    activeSection,
    settings,
    launchOnLogin,
    openWithAssociations,
    shortcuts,
    working,
    setActiveSection,
    updateSetting,
    load,
    removeOpenWithAssociation,
    setShortcut,
    saveShortcuts,
  } = useSettingsStore(
    useShallow((state) => ({
      activeSection: state.activeSection,
      settings: state.settings,
      launchOnLogin: state.launchOnLogin,
      openWithAssociations: state.openWithAssociations,
      shortcuts: state.shortcuts,
      working: state.working,
      setActiveSection: state.setActiveSection,
      updateSetting: state.updateSetting,
      load: state.load,
      removeOpenWithAssociation: state.removeOpenWithAssociation,
      setShortcut: state.setShortcut,
      saveShortcuts: state.saveShortcuts,
    })),
  );
  const app = useAppStore((state) => state.app);
  const document = settings?.document ?? {};
  const title = navItems.find((item) => item.id === activeSection)?.label ?? "General";
  const controlProps = {
    document,
    launchOnLogin,
    working,
    onSettingChange: updateSetting,
    onLoad: load,
    onShortcutChange: setShortcut,
    onSaveShortcuts: saveShortcuts,
    onRemoveOpenWithAssociation: removeOpenWithAssociation,
    shortcuts: shortcuts?.bindings ?? [],
    openWithAssociations,
    app,
  };

  return (
    <DesktopSettingsFrame
      activeId={activeSection}
      ariaLabel="Settings"
      description={sectionDescriptions[activeSection]}
      items={navItems}
      navigationLabel="Settings sections"
      navigationTitle="Misty settings"
      onClose={props.onClose}
      onSelect={setActiveSection}
      presentation={props.presentation}
      title={title}
    >
      <SettingsContent activeSection={activeSection} controlProps={controlProps} />
    </DesktopSettingsFrame>
  );
});

function SettingsContent(props: {
  activeSection: SettingsSection;
  controlProps: SettingsContentProps;
}) {
  return (
    <>
      {props.activeSection === "general" ? <GeneralSettings {...props.controlProps} /> : null}
      {props.activeSection === "app" ? <AppSettings {...props.controlProps} /> : null}
      {props.activeSection === "assistant" ? <AssistantSettings {...props.controlProps} /> : null}
      {props.activeSection === "appearance" ? <AppearanceSettings {...props.controlProps} /> : null}
      {props.activeSection === "privacy" ? <PrivacySettings {...props.controlProps} /> : null}
      {props.activeSection === "transfers" ? <TransfersSettings {...props.controlProps} /> : null}
      {props.activeSection === "search" ? <SearchSettings {...props.controlProps} /> : null}
      {props.activeSection === "notifications" ? (
        <NotificationsSettings {...props.controlProps} />
      ) : null}
      {props.activeSection === "shortcuts" ? <ShortcutsSettings {...props.controlProps} /> : null}
      {props.activeSection === "advanced" ? <AdvancedSettings {...props.controlProps} /> : null}
    </>
  );
}

function GeneralSettings(props: SettingsContentProps) {
  const launchOnLoginUnsupported = props.launchOnLogin?.supported === false;
  const launchOnLoginEnabled = props.launchOnLogin
    ? props.launchOnLogin.enabled
    : booleanSetting(props.document, "general", "launch_on_login", false);
  const workspaceRoot = stringSetting(props.document, "general", "preferred_workspace_root", "");
  return (
    <>
      <SettingsSectionBlock title="Startup">
        <SettingsRow
          label="Launch on login"
          description={
            launchOnLoginUnsupported
              ? "Unavailable on this platform."
              : "Start Misty automatically when you sign in to this device."
          }
          last
        >
          <SwitchControl
            checked={launchOnLoginEnabled}
            disabled={props.working || launchOnLoginUnsupported}
            onChange={(value) => props.onSettingChange("general", "launch_on_login", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Behavior">
        <SettingsRow
          label="Confirm destructive actions"
          description="Ask before delete, empty trash, and other irreversible actions."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "general", "confirm_destructive_actions", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "confirm_destructive_actions", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Default file action"
          description="Choose what a primary file interaction should do."
        >
          <SelectControl
            value={numberSetting(props.document, "general", "default_file_action_index", 0)}
            options={defaultFileActionOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "default_file_action_index", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Open links externally"
          description="Send external links to the system browser instead of handling them in-app."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "general", "open_links_externally", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "open_links_externally", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Defaults">
        <SettingsRow
          label="Files starting folder"
          description="Choose the default starting location for file browsing."
          last
        >
          <WorkspaceRootControl
            value={workspaceRoot}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "preferred_workspace_root", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function AppSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Updates">
        <div className="bg-muted/30 p-4">
          <InstallerCard embedded variant="compact" />
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Support Info">
        <SettingsRow
          label="Remote runtime"
          description="Provider requests run through the embedded Misty runtime."
        >
          <ValueText
            value={
              props.app?.storageRuntime.ready
                ? `Ready (${props.app.storageRuntime.version})`
                : (props.app?.storageRuntime.error ?? "Loading")
            }
            muted={!props.app?.storageRuntime.ready}
          />
        </SettingsRow>
        <SettingsRow label="App version" description="The installed Misty build version.">
          <ValueText value={props.app?.version ?? "Loading"} muted={!props.app?.version} />
        </SettingsRow>
        <SettingsRow
          label="Build info"
          description="Helpful runtime details for troubleshooting and support."
        >
          <ValueText value="Tauri desktop shell" muted />
        </SettingsRow>
        <SettingsRow
          label="Config path"
          description="Where Misty stores local configuration files on this device."
        >
          <CopyableValueText
            value={props.app?.environment.configDir ?? "Loading"}
            disabled={!props.app?.environment.configDir}
          />
        </SettingsRow>
        <SettingsRow
          label="Data path"
          description="Where Misty stores local app data on this device."
          last
        >
          <CopyableValueText
            value={props.app?.environment.mistyDir ?? "Loading"}
            disabled={!props.app?.environment.mistyDir}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function AssistantSettings(props: SettingsContentProps) {
  const assistant = selectAssistantPreferences(props.document);
  const updateScope = (
    key: "files_allowed" | "cleanup_allowed" | "search_allowed",
    value: boolean,
  ) => {
    props.onSettingChange("assistant", "scopes", assistantScopesPayload(assistant, key, value));
  };

  return (
    <>
      <SettingsSectionBlock title="Agents">
        <SettingsRow
          label="Enable Agents"
          description="Show Agents and let them help with files and folders."
          last
        >
          <SwitchControl
            checked={assistant.enabled}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("assistant", "enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Permissions">
        <SettingsRow
          label="Files"
          description="Allow Agents to inspect and organize files in the active Files folder."
        >
          <SwitchControl
            checked={assistant.scopes.filesAllowed}
            disabled={props.working || !assistant.enabled}
            onChange={(value) => updateScope("files_allowed", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Cleanup"
          description="Allow Agents to identify clutter and propose cleanup actions."
        >
          <SwitchControl
            checked={assistant.scopes.cleanupAllowed}
            disabled={props.working || !assistant.enabled}
            onChange={(value) => updateScope("cleanup_allowed", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Search"
          description="Allow Agents to search indexed files and folders."
          last
        >
          <SwitchControl
            checked={assistant.scopes.searchAllowed}
            disabled={props.working || !assistant.enabled}
            onChange={(value) => updateScope("search_allowed", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function assistantScopesPayload(
  assistant: ReturnType<typeof selectAssistantPreferences>,
  key: "files_allowed" | "cleanup_allowed" | "search_allowed",
  value: boolean,
): Record<string, unknown> {
  return {
    files_allowed: assistant.scopes.filesAllowed,
    cleanup_allowed: assistant.scopes.cleanupAllowed,
    search_allowed: assistant.scopes.searchAllowed,
    [key]: value,
  };
}

function AppearanceSettings(props: SettingsContentProps) {
  const themeMode = useAppThemeStore((state) => state.themeMode);
  const setThemeMode = useAppThemeStore((state) => state.setThemeMode);
  const themeIndex = themeModeToSettingsIndex(themeMode);

  return (
    <>
      <SettingsSectionBlock title="Theme">
        <SettingsRow
          label="Theme mode"
          description="Choose whether Misty follows the system appearance or uses a fixed theme."
        >
          <SelectControl
            value={themeIndex}
            options={themeOptions}
            disabled={props.working}
            onChange={(value) => {
              setThemeMode(settingsIndexToThemeMode(value));
              props.onSettingChange("appearance", "theme_index", value);
            }}
          />
        </SettingsRow>
        <SettingsRow
          label="UI scale"
          description="Adjust overall interface scale and density."
          last
        >
          <SelectControl
            value={numberSetting(props.document, "appearance", "ui_scale_index", 1)}
            options={scaleOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "ui_scale_index", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Layout">
        <SettingsRow
          label="Compact mode"
          description="Reduce padding and spacing in file-heavy views."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "compact_mode_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "compact_mode_enabled", value)}
          />
        </SettingsRow>
        {!isAndroidBuild ? (
          <>
            <SettingsRow
              label="App wallpaper"
              description="Choose an image, GIF, or video to show behind Misty pages."
            >
              <WallpaperControl
                value={stringSetting(
                  props.document,
                  "appearance",
                  "wallpaper_path",
                  stringSetting(props.document, "appearance", "home_wallpaper_path", ""),
                )}
                disabled={props.working}
                onChange={(value) => props.onSettingChange("appearance", "wallpaper_path", value)}
              />
            </SettingsRow>
            <SettingsRow
              label="Panel opacity"
              description="Lower values make app surfaces more transparent, revealing more wallpaper."
              last
            >
              <OpacityControl
                value={numberSetting(
                  props.document,
                  "appearance",
                  "panel_opacity",
                  numberSetting(props.document, "appearance", "home_panel_opacity", 0.82),
                )}
                disabled={props.working}
                onCommit={(value) => props.onSettingChange("appearance", "panel_opacity", value)}
              />
            </SettingsRow>
          </>
        ) : null}
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Typography">
        <SettingsRow
          label="Font size"
          description="Choose the baseline text size Misty should use."
          last
        >
          <SelectControl
            value={numberSetting(props.document, "appearance", "font_size_index", 1)}
            options={scaleOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "font_size_index", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Media">
        <SettingsRow
          label="Thumbnail previews"
          description="Show preview-rich file rows where supported."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "appearance",
              "thumbnail_previews_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("appearance", "thumbnail_previews_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Reduced motion"
          description="Tone down motion and animated transitions."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "reduced_motion_enabled", false)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("appearance", "reduced_motion_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function PrivacySettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Data handling">
        <SettingsRow
          label="Share anonymous usage analytics"
          description="Share first-open, onboarding, and application-session events. No filenames, paths, or content."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "privacy",
              "anonymous_usage_analytics_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("privacy", "anonymous_usage_analytics_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Send anonymous crash reports"
          description="Share sanitized unexpected React and Rust errors without file or account data."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "privacy",
              "anonymous_error_reporting_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("privacy", "anonymous_error_reporting_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Legal">
        <SettingsRow
          label="Privacy Policy"
          description="Review how Misty handles account and runtime data."
        >
          <ValueText value="Available soon" muted />
        </SettingsRow>
        <SettingsRow
          label="Terms of Service"
          description="Review product terms before release packaging."
          last
        >
          <ValueText value="Available soon" muted />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function TransferProfilesSettings(props: SettingsContentProps) {
  const transferProfiles = transferProfileRecords(props.document);
  const defaultProfileId = defaultTransferProfileId(props.document);
  const defaultProfileIndex = Math.max(
    0,
    transferProfiles.findIndex((profile) => profile.id === defaultProfileId),
  );
  const saveProfiles = (profiles: TransferProfileRecord[]) => {
    props.onSettingChange(
      "transfer_profiles",
      "profiles",
      profiles.map(transferProfileSettingsPayload),
    );
  };
  const updateProfile = (id: string, patch: Partial<TransferProfileRecord>) => {
    saveProfiles(
      transferProfiles.map((profile) => (profile.id === id ? { ...profile, ...patch } : profile)),
    );
  };
  const addProfile = () => {
    const id = `profile-${Date.now().toString(36)}`;
    const base =
      transferProfiles.find((profile) => profile.id === defaultProfileId) ?? transferProfiles[0];
    saveProfiles([
      ...transferProfiles,
      {
        id,
        name: "Custom Profile",
        transfers: base?.transfers ?? 4,
        checkers: base?.checkers ?? 8,
        bandwidthLimit: base?.bandwidthLimit ?? "",
        retries: base?.retries ?? 3,
        lowLevelRetries: base?.lowLevelRetries ?? 10,
        checksum: base?.checksum ?? false,
        builtIn: false,
      },
    ]);
    props.onSettingChange("transfer_profiles", "default_profile_id", id);
  };
  const removeProfile = (id: string) => {
    const next = transferProfiles.filter((profile) => profile.id !== id);
    saveProfiles(next);
    if (defaultProfileId === id) {
      props.onSettingChange("transfer_profiles", "default_profile_id", next[0]?.id ?? "balanced");
    }
  };
  return (
    <SettingsSectionBlock title="Transfer profiles">
      <SettingsRow
        label="Default profile"
        description="Choose the saved transfer behavior Misty should preselect."
      >
        <SelectControl
          value={defaultProfileIndex}
          options={transferProfiles.map((profile) => profile.name)}
          disabled={props.working}
          onChange={(value) =>
            props.onSettingChange(
              "transfer_profiles",
              "default_profile_id",
              transferProfiles[value]?.id ?? "balanced",
            )
          }
        />
      </SettingsRow>
      <div className={settingsReferenceListClass}>
        <div className={`${settingsReferenceRowClass} ${settingsReferenceHeaderClass}`}>
          <span>Name</span>
          <span>Behavior</span>
        </div>
        {transferProfiles.map((profile) => (
          <div className={settingsReferenceRowClass} key={profile.id}>
            <span className={settingsReferenceSpanClass}>
              {profile.builtIn ? (
                profile.name
              ) : (
                <TextControl
                  value={profile.name}
                  disabled={props.working}
                  onCommit={(value) =>
                    updateProfile(profile.id, {
                      name: value.trim() || "Custom Profile",
                    })
                  }
                />
              )}
            </span>
            <span className="grid justify-items-end gap-2 text-right text-muted-foreground">
              <span>
                {profile.transfers} transfers / {profile.checkers} checks
                {profile.bandwidthLimit ? ` · ${profile.bandwidthLimit}` : ""}
                {profile.checksum ? " · checksum" : ""}
              </span>
              {!profile.builtIn ? (
                <span className="flex flex-wrap justify-end gap-2">
                  <ProfileNumberInput
                    label="Transfers"
                    value={profile.transfers}
                    disabled={props.working}
                    onCommit={(value) => updateProfile(profile.id, { transfers: value })}
                  />
                  <ProfileNumberInput
                    label="Checkers"
                    value={profile.checkers}
                    disabled={props.working}
                    onCommit={(value) => updateProfile(profile.id, { checkers: value })}
                  />
                  <ProfileTextInput
                    label="Limit"
                    value={profile.bandwidthLimit}
                    disabled={props.working}
                    onCommit={(value) => updateProfile(profile.id, { bandwidthLimit: value })}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className={settingsControlButtonCompactClass}
                    type="button"
                    disabled={props.working}
                    onClick={() =>
                      updateProfile(profile.id, {
                        checksum: !profile.checksum,
                      })
                    }
                  >
                    {profile.checksum ? "Checksum" : "Fast"}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className={settingsIconDangerClass}
                    type="button"
                    disabled={props.working}
                    aria-label={`Remove ${profile.name}`}
                    onClick={() => removeProfile(profile.id)}
                  >
                    <Trash2 size={15} strokeWidth={1.8} />
                  </Button>
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div className={settingsInlineActionsClass}>
        <Button
          className={settingsPrimaryButtonClass}
          type="button"
          disabled={props.working}
          onClick={addProfile}
        >
          Add Profile
        </Button>
      </div>
    </SettingsSectionBlock>
  );
}

function TransfersSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Defaults">
        <SettingsRow
          label="Default transfer behavior"
          description="Choose how copy and download flows should behave by default."
          last
        >
          <SelectControl
            value={numberSetting(props.document, "general", "default_transfer_behavior_index", 0)}
            options={transferBehaviorOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "default_transfer_behavior_index", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <TransferProfilesSettings {...props} />
    </>
  );
}

function SearchSettings(props: SettingsContentProps) {
  const { status, error, initialize, refreshStatus, startScan, cancelScan } = useSearchStore(
    useShallow((state) => ({
      status: state.status,
      error: state.error,
      initialize: state.initialize,
      refreshStatus: state.refreshStatus,
      startScan: state.startScan,
      cancelScan: state.cancelScan,
    })),
  );
  useEffect(() => {
    void initialize();
    const timer = window.setInterval(
      () => {
        void refreshStatus();
      },
      status?.scanInProgress ? 700 : 5000,
    );
    return () => window.clearInterval(timer);
  }, [initialize, refreshStatus, status?.scanInProgress]);

  const scanActive = Boolean(status?.scanInProgress);
  const indexedItems = status?.indexedItemCount ?? 0;
  const indexedLocalRoots = status?.indexedLocalRoots ?? [];
  const indexedRemoteNames = status?.indexedRemoteNames ?? [];
  const scanProgress = status?.scanIndexedItemCount ?? 0;
  const lastIndexed = status?.lastScanTimeMs ? formatDate(status.lastScanTimeMs) : "Never";
  const automaticFileDiscovery = booleanSetting(
    props.document,
    "search",
    "automatic_file_discovery_enabled",
    true,
  );
  return (
    <>
      <div className="mb-4 grid gap-3">
        <SearchHealthCard
          icon={<Search size={19} />}
          title="File search"
          value={scanActive ? "Updating quietly" : indexedItems ? "Ready" : "Getting ready"}
          detail={
            indexedItems
              ? `${indexedItems.toLocaleString()} files and folders available to search`
              : "Misty will discover filenames without using AI"
          }
          active={scanActive}
        />
      </div>

      <SettingsSectionBlock title="Automatic upkeep">
        <SettingsRow
          label="Keep file search ready"
          description="Misty checks for added, renamed, moved, or removed files while the app is open. Existing results stay searchable during updates."
          last
        >
          <SwitchControl
            checked={automaticFileDiscovery}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("search", "automatic_file_discovery_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Files available to search">
        <div className="grid gap-4 px-5 py-5">
          <div className="flex items-start justify-between gap-5">
            <div className="flex min-w-0 gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                {scanActive ? (
                  <Spinner label="Checking files" size="lg" />
                ) : (
                  <HardDrive size={18} />
                )}
              </div>
              <div className="grid min-w-0 gap-1">
                <strong className="text-sm font-medium text-foreground">
                  {scanActive
                    ? "Checking for file changes"
                    : indexedItems
                      ? "Search is kept up to date"
                      : "Ready for the first check"}
                </strong>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {scanActive
                    ? `${scanProgress.toLocaleString()} items checked${status?.currentPath ? ` · ${shortPath(status.currentPath)}` : ""}`
                    : status?.lastScanTimeMs
                      ? `Last checked ${lastIndexed}. Misty found ${formatSearchChanges(status)}.`
                      : "Run the first check to make filenames and folders available from Spotlight."}
                </span>
                {error || status?.lastScanError ? (
                  <span className="text-sm text-destructive">
                    {userFacingErrorText(error || status?.lastScanError)}
                  </span>
                ) : null}
              </div>
            </div>
            {scanActive ? (
              <Button
                variant="outline"
                size="sm"
                className={settingsControlButtonCompactClass}
                type="button"
                onClick={() => void cancelScan()}
              >
                Stop
              </Button>
            ) : (
              <Button
                variant="outline"
                className={settingsControlButtonClass}
                type="button"
                onClick={() => void startScan("")}
              >
                Check now
              </Button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-4 max-[720px]:grid-cols-1">
            <SearchStatCard label="Searchable" value={indexedItems.toLocaleString()} compact />
            <SearchStatCard
              label="On this device"
              value={(status?.indexedLocalItemCount ?? 0).toLocaleString()}
              compact
            />
            <SearchStatCard
              label="Cloud files"
              value={(status?.indexedRemoteItemCount ?? 0).toLocaleString()}
              compact
            />
          </div>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Covered: {friendlyCoverage(indexedLocalRoots, indexedRemoteNames)}. Common build and
            cache folders are skipped automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            {indexedLocalRoots.map((root, index) => (
              <Badge variant="secondary" className="gap-1.5" key={root} title={root}>
                <FolderOpen size={12} />
                {coverageRootLabel(root, index)}
              </Badge>
            ))}
            {indexedRemoteNames.map((name) => (
              <Badge variant="secondary" className="gap-1.5" key={name}>
                <Cloud size={12} />
                {name}
              </Badge>
            ))}
          </div>
        </div>
      </SettingsSectionBlock>

      {status?.scanErrors.length ? (
        <SettingsSectionBlock title="Files Misty could not check">
          <div className={settingsReferenceListClass}>
            <div className={`${settingsReferenceRowClass} ${settingsReferenceHeaderClass}`}>
              <span>Source</span>
              <span>Error</span>
            </div>
            {status.scanErrors.map((scanError) => (
              <div
                className={settingsReferenceRowClass}
                key={`${scanError.source}:${scanError.message}`}
              >
                <span className={settingsReferenceSpanClass}>{scanError.source}</span>
                <span className="min-w-0 [overflow-wrap:anywhere] text-destructive">
                  {userFacingErrorText(scanError.message)}
                </span>
              </div>
            ))}
          </div>
        </SettingsSectionBlock>
      ) : null}
    </>
  );
}

function SearchHealthCard(props: {
  icon: ReactNode;
  title: string;
  value: string;
  detail: string;
  active?: boolean;
  attention?: boolean;
}) {
  return (
    <div className="grid min-h-28 grid-cols-[40px_minmax(0,1fr)] gap-3 rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10">
      <div
        className={`grid size-10 place-items-center rounded-lg ${props.attention ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
      >
        {props.active ? <Spinner label="Updating file search" size="lg" /> : props.icon}
      </div>
      <div className="grid content-center gap-1">
        <span className="text-xs text-muted-foreground">{props.title}</span>
        <strong className="text-lg font-semibold text-foreground">{props.value}</strong>
        <span className="text-xs leading-relaxed text-muted-foreground">{props.detail}</span>
      </div>
    </div>
  );
}

function SearchStatCard(props: { label: string; value: string; compact?: boolean }) {
  return (
    <div
      className={`${props.compact ? "min-h-[54px]" : "min-h-[76px]"} grid content-center gap-1 rounded-md bg-muted/45 px-3`}
    >
      <strong
        className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${props.compact ? "text-base" : "text-xl"} font-semibold tabular-nums text-foreground`}
      >
        {props.value}
      </strong>
      <span className="text-xs text-muted-foreground">{props.label}</span>
    </div>
  );
}

function formatSearchChanges(status: SearchStatus): string {
  const changes = [
    [status.lastScanAddedItemCount ?? 0, "new"],
    [status.lastScanUpdatedItemCount ?? 0, "updated"],
    [status.lastScanRemovedItemCount ?? 0, "removed"],
  ] as const;
  const visible = changes.filter(([count]) => count > 0);
  return visible.length
    ? visible.map(([count, label]) => `${count.toLocaleString()} ${label}`).join(", ")
    : "no changes";
}

function friendlyCoverage(localRoots: string[], remoteNames: string[]): string {
  const pieces: string[] = [];
  if (localRoots.length === 1) pieces.push("your home folder");
  else if (localRoots.length > 1) pieces.push(`${localRoots.length} folders on this device`);
  if (remoteNames.length === 1) pieces.push(`the ${remoteNames[0]} cloud connection`);
  else if (remoteNames.length > 1) pieces.push(`${remoteNames.length} cloud connections`);
  return pieces.length ? pieces.join(" and ") : "no folders yet";
}

function coverageRootLabel(path: string, index: number): string {
  if (index === 0) return "Home folder";
  return path.split(/[\\/]/).filter(Boolean).pop() || "Local folder";
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
}

function NotificationsSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Activity alerts">
        <SettingsRow
          label="Desktop notifications"
          description="Show system-level notifications for important events."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "notifications",
              "desktop_notifications_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "desktop_notifications_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow label="In-app toasts" description="Show transient notifications inside Misty.">
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "notifications",
              "in_app_notifications_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "in_app_notifications_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Play sounds"
          description="Use sound for completion and error alerts."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "notifications",
              "sound_notifications_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "sound_notifications_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="System notifications">
        <SettingsRow
          label="Badge count"
          description="Show pending activity counts where the platform supports it."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "badge_count_enabled", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "badge_count_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Digest & quiet hours">
        <SettingsRow
          label="Quiet hours"
          description="Suppress non-critical notifications during focus time."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "quiet_hours_enabled", false)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "quiet_hours_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Notification digest"
          description="Bundle lower-priority updates into a lighter summary."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "notifications",
              "digest_notifications_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("notifications", "digest_notifications_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function ShortcutsSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Navigation">
        <SettingsRow
          label="Show shortcut hints"
          description="Display shortcut hints in tooltips and menus where helpful."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "shortcut_hints_enabled", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("shortcuts", "shortcut_hints_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Customization">
        <SettingsRow
          label="Keymap preset"
          description="Choose the shortcut style that feels most natural on this device."
        >
          <SelectControl
            value={numberSetting(props.document, "shortcuts", "keymap_index", 0)}
            options={keymapOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("shortcuts", "keymap_index", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Enable custom shortcuts"
          description="Use saved per-command shortcut overrides instead of only Misty's built-in defaults."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "custom_shortcuts_enabled", false)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("shortcuts", "custom_shortcuts_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Reference">
        <SettingsNote>
          Review the active bindings Misty has loaded so shortcut behavior is easy to test.
        </SettingsNote>
        <div className={settingsReferenceListClass}>
          <div className={`${settingsReferenceRowClass} ${settingsReferenceHeaderClass}`}>
            <span>Command</span>
            <span>Shortcut</span>
          </div>
          {props.shortcuts.map((binding) => (
            <div className={settingsReferenceRowClass} key={binding.commandId}>
              <span className={settingsReferenceSpanClass}>{binding.commandId}</span>
              <Input
                value={binding.shortcut}
                disabled={props.working}
                onChange={(event) => props.onShortcutChange(binding.commandId, event.target.value)}
              />
            </div>
          ))}
        </div>
        <div className={settingsInlineActionsClass}>
          <Button
            type="button"
            className={settingsPrimaryButtonClass}
            disabled={props.working}
            onClick={() => void props.onSaveShortcuts()}
          >
            Save Changes
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            className={settingsControlButtonCompactClass}
            disabled={props.working}
            onClick={() => void props.onLoad()}
          >
            Reset
          </Button>
        </div>
      </SettingsSectionBlock>
    </>
  );
}

function AdvancedSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Diagnostics">
        <SettingsRow
          label="Loaded views"
          description="Top-level views currently instantiated in memory."
        >
          <ValueText value="Tauri route shell" muted />
        </SettingsRow>
        <SettingsRow
          label="Frame pacing overlay"
          description="Show the live idle, light, and heavy pacing state in the top-right corner."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "advanced",
              "frame_pacing_overlay_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("advanced", "frame_pacing_overlay_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Connection">
        <SettingsRow
          label="Extension tools PATH"
          description="Directories Misty searches for tools such as FFmpeg and yt-dlp. Defaults to your macOS login-shell PATH. Enter PATH directories only, separated by colons—not a shell command."
        >
          <TextControl
            value={stringSetting(props.document, "advanced", "extension_tools_path", "")}
            placeholder="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "extension_tools_path", value)}
            wide
          />
        </SettingsRow>
        <SettingsRow
          label="Server address"
          description="The gRPC address Misty uses for local file operations."
        >
          <TextControl
            value={stringSetting(props.document, "advanced", "server_address", "localhost:50051")}
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "server_address", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Mount path"
          description="The root path Misty should treat as its default mount target."
          last
        >
          <TextControl
            value={stringSetting(props.document, "advanced", "mount_path", ".misty/mnt")}
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "mount_path", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Open with associations">
        <SettingsNote>Review remembered apps used by File Explorer.</SettingsNote>
        <div className={settingsReferenceListClass}>
          <div className={`${settingsAssociationRowClass} ${settingsReferenceHeaderClass}`}>
            <span>File</span>
            <span>Application</span>
            <span />
          </div>
          {props.openWithAssociations.map((association) => (
            <div className={settingsAssociationRowClass} key={association.key}>
              <span className={settingsReferenceSpanClass}>{association.key}</span>
              <span
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                title={association.applicationPath}
              >
                {association.applicationPath}
              </span>
              <Button
                variant="outline"
                size="icon"
                type="button"
                className={settingsIconDangerClass}
                aria-label={`Remove ${association.key}`}
                disabled={props.working}
                onClick={() => void props.onRemoveOpenWithAssociation(association.key)}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
          {props.openWithAssociations.length === 0 ? (
            <p className={settingsEmptyClass}>No Open With associations saved.</p>
          ) : null}
        </div>
      </SettingsSectionBlock>
    </>
  );
}

function SettingsNote(props: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-2xl px-5 py-4 text-sm leading-5 text-muted-foreground">
      {props.children}
    </p>
  );
}

function WorkspaceRootControl(props: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const pickerAvailable = hasTauriInternals();
  const chooseFolder = async () => {
    if (!pickerAvailable) return;
    const selection = await open({
      title: "Choose Workspace Root",
      multiple: false,
      directory: true,
    });
    const path = Array.isArray(selection) ? selection[0] : selection;
    if (path) props.onChange(path);
  };

  return (
    <div className="grid min-w-0 justify-items-end gap-2 max-[760px]:justify-items-start">
      <span
        className={`max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm max-[760px]:text-left ${props.value ? "text-foreground" : "text-muted-foreground"}`}
        title={props.value || "Default"}
      >
        {props.value || "Default"}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          className={settingsControlButtonCompactClass}
          disabled={props.disabled || !pickerAvailable}
          title={
            pickerAvailable ? "Choose workspace root" : "Folder picker unavailable on this platform"
          }
          onClick={() => void chooseFolder()}
        >
          Choose
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          className={settingsControlButtonCompactClass}
          disabled={props.disabled || !props.value}
          onClick={() => props.onChange("")}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

function WallpaperControl(props: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const pickerAvailable = hasTauriInternals();
  const chooseWallpaper = async () => {
    if (!pickerAvailable) return;
    const selection = await open({
      title: "Choose App Wallpaper",
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Images and videos",
          extensions: [
            "apng",
            "avif",
            "bmp",
            "gif",
            "jpg",
            "jpeg",
            "png",
            "svg",
            "webp",
            "m4v",
            "mov",
            "mp4",
            "ogv",
            "webm",
          ],
        },
      ],
    });
    const path = Array.isArray(selection) ? selection[0] : selection;
    if (path) props.onChange(path);
  };

  return (
    <div className="grid w-full min-w-0 justify-items-end gap-2 max-[760px]:justify-items-start">
      <span
        className={`block w-full min-w-0 max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm max-[760px]:text-left ${props.value ? "text-foreground" : "text-muted-foreground"}`}
        title={props.value || "None"}
      >
        {props.value || "None"}
      </span>
      <div className="grid w-full max-w-[360px] grid-cols-2 gap-2">
        <Button
          variant="outline"
          type="button"
          className={`${settingsControlButtonClass} w-full`}
          disabled={props.disabled || !pickerAvailable}
          title={
            pickerAvailable ? "Choose app wallpaper" : "File picker unavailable on this platform"
          }
          onClick={() => void chooseWallpaper()}
        >
          <Image size={15} />
          Choose
        </Button>
        <Button
          variant="outline"
          type="button"
          className={`${settingsControlButtonClass} w-full`}
          disabled={props.disabled || !props.value}
          onClick={() => props.onChange("")}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

function OpacityControl(props: {
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const normalizedValue = clampOpacity(props.value);
  const [draftPercent, setDraftPercent] = useState(Math.round(normalizedValue * 100));

  useEffect(() => {
    setDraftPercent(Math.round(normalizedValue * 100));
  }, [normalizedValue]);

  const commitDraft = (percent = draftPercent) => {
    const nextValue = clampOpacity(percent / 100);
    if (nextValue !== normalizedValue) props.onCommit(nextValue);
  };

  return (
    <div className="grid w-full min-w-0 max-w-[360px] justify-items-end gap-2 max-[760px]:justify-items-start">
      <span className="text-sm font-medium tabular-nums text-foreground">{draftPercent}%</span>
      <Slider
        aria-label="Panel opacity"
        className="h-8 w-[220px] max-w-full"
        disabled={props.disabled}
        min={0}
        max={100}
        step={1}
        value={[draftPercent]}
        onValueChange={(values) => {
          setDraftPercent(values[0] ?? draftPercent);
        }}
        onValueCommit={(values) => {
          commitDraft(values[0] ?? draftPercent);
        }}
      />
    </div>
  );
}

function SelectControl(props: {
  value: number;
  options: string[];
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Select
      value={String(Math.min(props.value, props.options.length - 1))}
      disabled={props.disabled}
      onValueChange={(value) => props.onChange(Number(value))}
    >
      <SelectTrigger className="w-[220px] max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option, index) => (
          <SelectItem key={option} value={String(index)}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SwitchControl(props: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} />
  );
}

function TextControl(props: {
  value: string;
  placeholder?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  wide?: boolean;
}) {
  const handleCommit = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.value !== props.value) {
      props.onCommit(event.currentTarget.value);
    }
  };

  return (
    <Input
      key={props.value}
      className={props.wide ? "w-full max-w-[520px]" : "w-[220px] max-w-full"}
      defaultValue={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onBlur={handleCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ProfileNumberInput(props: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const handleCommit = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Math.max(1, Math.round(Number(event.currentTarget.value) || props.value));
    if (next !== props.value) props.onCommit(next);
  };
  return (
    <label className="grid gap-1 text-left text-[11px] text-muted-foreground">
      {props.label}
      <Input
        key={props.value}
        className="h-8 w-[76px]"
        defaultValue={props.value}
        disabled={props.disabled}
        inputMode="numeric"
        type="number"
        min={1}
        onBlur={handleCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function ProfileTextInput(props: {
  label: string;
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const handleCommit = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.value !== props.value) props.onCommit(event.currentTarget.value.trim());
  };
  return (
    <label className="grid gap-1 text-left text-[11px] text-muted-foreground">
      {props.label}
      <Input
        key={props.value}
        className="h-8 w-[92px]"
        defaultValue={props.value}
        disabled={props.disabled}
        placeholder="None"
        onBlur={handleCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function ValueText(props: { value: string; muted?: boolean }) {
  return (
    <span
      className={`max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm max-[760px]:text-left ${props.muted ? "text-muted-foreground" : "text-foreground"}`}
    >
      {props.value}
    </span>
  );
}

function CopyableValueText(props: { value: string; disabled?: boolean }) {
  const copyValue = () => {
    if (props.disabled) return;
    void navigator.clipboard?.writeText(props.value).catch(() => undefined);
  };

  return (
    <span className="flex min-w-0 max-w-[420px] items-center justify-end gap-2 max-[760px]:justify-start">
      <span
        className={`min-w-0 select-text overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm max-[760px]:text-left ${props.disabled ? "text-muted-foreground" : "text-foreground"}`}
        title={props.value}
      >
        {props.value}
      </span>
      <Button
        variant="outline"
        size="icon"
        type="button"
        disabled={props.disabled}
        aria-label="Copy value"
        title="Copy"
        onClick={copyValue}
      >
        <Copy size={14} />
      </Button>
    </span>
  );
}

function sectionRecord(
  document: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  const value = document[section];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: number,
): number {
  const value = sectionRecord(document, section)[key];
  return typeof value === "number" ? value : fallback;
}

function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

function booleanSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: boolean,
): boolean {
  const value = sectionRecord(document, section)[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: string,
): string {
  const value = sectionRecord(document, section)[key];
  return typeof value === "string" ? value : fallback;
}

export default SettingsWorkspace;
