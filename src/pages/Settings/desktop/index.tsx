import {
  memo,
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import {
  AppWindow,
  ArrowLeftRight,
  Bell,
  Bot,
  ChevronDown,
  Copy,
  Eye,
  Image,
  Keyboard,
  Lock,
  RefreshCcw,
  Rows3,
  Search,
  Settings2,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { InstallerCard } from "../../../components/installer/InstallerCard";
import { useAppStore } from "../../../stores/useAppStore";
import {
  settingsIndexToThemeMode,
  themeModeToSettingsIndex,
  useAppThemeStore,
} from "../../../stores/useAppThemeStore";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  ShortcutBinding,
} from "../../../api/types";
import {
  fontLabelFromPath,
  selectAssistantPreferences,
  selectCustomFontPreferences,
  useSettingsStore,
  type CustomFontPreference,
} from "../../../stores/useSettingsStore";
import { useSearchStore } from "../../../stores/useSearchStore";
import { formatBytes, formatDate } from "../../Files/utils/fileFormat";
import { userFacingErrorText } from "../../../shared/format";
import { hasTauriInternals } from "../../../shared/tauri";
import { isAndroidBuild } from "../../../platform/buildTarget";
import {
  defaultTransferProfileId,
  transferProfileRecords,
  transferProfileSettingsPayload,
  type TransferProfileRecord,
} from "../transferProfiles";

type SettingsSection =
  | "general"
  | "app"
  | "assistant"
  | "appearance"
  | "privacy"
  | "sync"
  | "transfers"
  | "search"
  | "notifications"
  | "shortcuts"
  | "advanced";
type SettingValue = string | number | boolean | Record<string, unknown> | Array<Record<string, unknown>>;

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}

const appNavItems: NavItem[] = [
  { id: "general", label: "General", icon: Rows3 },
  { id: "app", label: "App", icon: AppWindow },
  { id: "assistant", label: "Assistant", icon: Bot },
  { id: "appearance", label: "Appearance", icon: Eye },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "sync", label: "Sync", icon: RefreshCcw },
  { id: "transfers", label: "Transfers", icon: ArrowLeftRight },
  { id: "search", label: "Search", icon: Search },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "advanced", label: "Advanced", icon: Settings2 },
];

const navGroups = [{ label: "Misty App Settings", items: appNavItems }];

const navItems = appNavItems;

const defaultFileActionOptions = ["Open", "Preview", "Show Details"];
const transferBehaviorOptions = ["Ask Every Time", "Use Default Location"];
const themeOptions = ["System", "Dark", "Light"];
const scaleOptions = ["Small", "Default", "Large"];
const keymapOptions = ["System", "VS Code", "Finder"];
const conflictOptions = ["Keep Newest", "Ask Me", "Keep Both"];

const settingsGridClass =
  "grid h-screen min-h-0 min-w-0 grid-cols-[180px_1px_minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-shell-bg,#050607)] text-[#f4f4f5] max-[980px]:grid-cols-[150px_1px_minmax(720px,1fr)] max-[980px]:overflow-x-auto max-[980px]:overflow-y-hidden";

const settingsOverlayGridClass =
  "grid h-full min-h-0 min-w-0 grid-cols-[214px_1px_minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-shell-bg,#050607)] text-[#f4f4f5] max-[980px]:grid-cols-[180px_1px_minmax(620px,1fr)] max-[980px]:overflow-x-auto max-[980px]:overflow-y-hidden";

const settingsSidebarClass =
  "flex min-h-0 flex-col gap-[5px] bg-[var(--misty-app-nav-bg,var(--misty-app-shell-bg,#050607))] p-5 max-[980px]:px-2.5 max-[980px]:py-4";

const settingsNavItemClass =
  "grid h-9 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-3 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-left text-[15px] text-[#a1a1aa] hover:border-white/10 hover:bg-white/[0.045] hover:text-[#f4f4f5]";

const settingsNavItemSelectedClass =
  "border-white/15 bg-[#f4f4f5] text-[#07090b] hover:bg-white hover:text-[#07090b]";

const settingsContentClass =
  "misty-scrollbar min-h-0 min-w-0 overflow-auto bg-[var(--misty-app-shell-bg,#050607)] px-7 py-6";

const settingsOverlayContentShellClass =
  "grid min-h-0 min-w-0 grid-rows-[72px_minmax(0,1fr)] bg-[var(--misty-app-shell-bg,#050607)]";

const settingsOverlayHeaderClass =
  "flex min-h-0 items-center justify-between gap-4 border-b border-white/10 px-7";

const settingsOverlayContentClass =
  "misty-scrollbar min-h-0 min-w-0 overflow-auto bg-[var(--misty-app-shell-bg,#050607)] px-7 py-5";

const settingsScrollSurfaceClass = "w-[min(100%,934px)] min-w-[720px]";

const settingsOverlayScrollSurfaceClass = "w-[min(100%,720px)] min-w-[560px]";

const settingsOverlayCloseClass =
  "grid size-8 place-items-center rounded-md border border-transparent bg-transparent p-0 text-[#a1a1aa] transition hover:border-white/10 hover:bg-white/[0.045] hover:text-[#f4f4f5]";

const settingsControlButtonClass =
  "inline-flex h-8 w-[220px] items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/[0.055] text-[15px] font-semibold text-[#f4f4f5] transition hover:border-white/20 hover:bg-white/[0.09] disabled:opacity-55";

const settingsControlButtonCompactClass = `${settingsControlButtonClass} w-[100px]`;

const settingsPrimaryButtonClass =
  "inline-flex h-[34px] w-[140px] items-center justify-center rounded-md border border-[#f4f4f5] bg-[#f4f4f5] text-[15px] font-bold text-[#07090b] transition hover:bg-white disabled:opacity-55";

const settingsReferenceListClass = "grid min-w-0";

const settingsReferenceRowClass =
  "grid min-h-[54px] grid-cols-[minmax(0,0.52fr)_minmax(220px,0.48fr)] items-center gap-[18px] border-b border-white/[0.08] px-7 py-[7px] text-sm text-[#f4f4f5]";

const settingsReferenceHeaderClass = "min-h-[42px] text-[15px]";

const settingsReferenceSpanClass = "min-w-0 [overflow-wrap:anywhere]";

const settingsReferenceInputClass =
  "h-9 w-full rounded-md border border-white/10 bg-[#07090b] px-2.5 text-[#f4f4f5] outline-none focus:border-white/30";

const settingsIconDangerClass =
  "grid h-[30px] w-[30px] place-items-center rounded-md border border-white/10 bg-white/[0.045] text-[#f4f4f5] transition hover:border-[#fca5a5]/40 hover:text-[#fca5a5] disabled:opacity-55";

const settingsInlineActionsClass = "flex items-center gap-3 px-7 py-4";

const settingsEmptyClass = "px-7 py-4 text-sm text-[#8f8f8f]";

const settingsFontRowClass =
  "grid min-h-[54px] grid-cols-[minmax(110px,0.24fr)_minmax(0,1fr)_32px] items-center gap-[18px] border-b border-white/[0.08] px-7 py-[7px] text-sm text-[#f4f4f5]";

const settingsAssociationRowClass =
  "grid min-h-[54px] grid-cols-[minmax(110px,0.22fr)_minmax(0,1fr)_32px] items-center gap-[18px] border-b border-white/[0.08] px-7 py-[7px] text-sm text-[#f4f4f5]";

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
  const title =
    navItems.find((item) => item.id === activeSection)?.label ?? "General";
  const activeIcon =
    navItems.find((item) => item.id === activeSection)?.icon ?? Settings2;
  const ActiveIcon = activeIcon;
  const overlay = props.presentation === "overlay";

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
    <section
      className={overlay ? settingsOverlayGridClass : settingsGridClass}
      aria-label="Settings"
    >
      <aside className={settingsSidebarClass} aria-label="Settings sections">
        {navGroups.map((group) => (
          <div className="grid gap-[5px]" key={group.label}>
            <span className="px-2 pb-3 pt-2 text-[10px] font-bold uppercase tracking-normal text-[#767676]">
              {overlay ? "Settings" : group.label}
            </span>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${settingsNavItemClass} ${activeSection === item.id ? settingsNavItemSelectedClass : ""}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </aside>
      <div className="w-px bg-white/10" />
      {overlay ? (
        <main className={settingsOverlayContentShellClass}>
          <header className={settingsOverlayHeaderClass}>
            <div className="flex min-w-0 items-center gap-3">
              <ActiveIcon
                size={17}
                strokeWidth={1.8}
                className="shrink-0 text-[#8d8d8d]"
              />
              <h1 className="m-0 min-w-0 truncate text-[15px] font-[740] leading-tight tracking-normal text-[#f4f4f5]">
                {title}
              </h1>
            </div>
            <button
              type="button"
              className={settingsOverlayCloseClass}
              aria-label="Close settings"
              title="Close settings"
              onClick={props.onClose}
            >
              <X size={17} strokeWidth={1.8} />
            </button>
          </header>
          <SettingsContent
            activeSection={activeSection}
            className={settingsOverlayContentClass}
            controlProps={controlProps}
            surfaceClassName={settingsOverlayScrollSurfaceClass}
            title={null}
          />
        </main>
      ) : (
        <SettingsContent
          activeSection={activeSection}
          className={settingsContentClass}
          controlProps={controlProps}
          surfaceClassName={settingsScrollSurfaceClass}
          title={title}
        />
      )}
    </section>
  );
});

function SettingsContent(props: {
  activeSection: SettingsSection;
  className: string;
  controlProps: SettingsContentProps;
  surfaceClassName: string;
  title: string | null;
}) {
  return (
    <main className={props.className}>
      <div className={props.surfaceClassName}>
        {props.title ? (
          <h1 className="mb-[18px] mt-1 text-[28px] font-[760] leading-[1.15] tracking-normal text-[#f4f4f5]">
            {props.title}
          </h1>
        ) : null}
        {props.activeSection === "general" ? (
          <GeneralSettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "app" ? (
          <AppSettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "assistant" ? (
          <AssistantSettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "appearance" ? (
          <AppearanceSettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "privacy" ? (
          <PrivacySettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "sync" ? (
          <SyncSettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "transfers" ? (
          <TransfersSettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "search" ? (
          <SearchSettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "notifications" ? (
          <NotificationsSettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "shortcuts" ? (
          <ShortcutsSettings {...props.controlProps} />
        ) : null}
        {props.activeSection === "advanced" ? (
          <AdvancedSettings {...props.controlProps} />
        ) : null}
      </div>
    </main>
  );
}

interface SettingsContentProps {
  document: Record<string, unknown>;
  launchOnLogin: LaunchOnLoginSnapshot | null;
  working: boolean;
  onSettingChange: (section: string, key: string, value: SettingValue) => void;
  onLoad: () => Promise<void>;
  onShortcutChange: (commandId: string, shortcut: string) => void;
  onSaveShortcuts: () => Promise<void>;
  onRemoveOpenWithAssociation: (key: string) => Promise<void>;
  shortcuts: ShortcutBinding[];
  openWithAssociations: OpenWithAssociation[];
  app: ReturnType<typeof useAppStore.getState>["app"];
}

function GeneralSettings(props: SettingsContentProps) {
  const launchOnLoginUnsupported = props.launchOnLogin?.supported === false;
  const launchOnLoginEnabled = props.launchOnLogin
    ? props.launchOnLogin.enabled
    : booleanSetting(props.document, "general", "launch_on_login", false);
  const workspaceRoot = stringSetting(
    props.document,
    "general",
    "preferred_workspace_root",
    "",
  );
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
            onChange={(value) =>
              props.onSettingChange("general", "launch_on_login", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Behavior">
        <SettingsRow
          label="Confirm destructive actions"
          description="Ask before delete, empty trash, and other irreversible actions."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "general",
              "confirm_destructive_actions",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "general",
                "confirm_destructive_actions",
                value,
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Default file action"
          description="Choose what a primary file interaction should do."
        >
          <SelectControl
            value={numberSetting(
              props.document,
              "general",
              "default_file_action_index",
              0,
            )}
            options={defaultFileActionOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "general",
                "default_file_action_index",
                value,
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Open links externally"
          description="Send external links to the system browser instead of handling them in-app."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "general",
              "open_links_externally",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "open_links_externally", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Defaults">
        <SettingsRow
          label="Preferred workspace root"
          description="Choose the default starting location for file browsing."
          last
        >
          <WorkspaceRootControl
            value={workspaceRoot}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "general",
                "preferred_workspace_root",
                value,
              )
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
        <div className="bg-[#07090b] p-4">
          <InstallerCard embedded variant="compact" />
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Support Info">
        <SettingsRow
          label="Remote runtime"
          description="Provider requests run through the embedded Misty runtime."
        >
          <ValueText
            value={props.app?.storageRuntime.ready ? `Ready (${props.app.storageRuntime.version})` : props.app?.storageRuntime.error ?? "Loading"}
            muted={!props.app?.storageRuntime.ready}
          />
        </SettingsRow>
        <SettingsRow
          label="App version"
          description="The installed Misty build version."
        >
          <ValueText
            value={props.app?.version ?? "Loading"}
            muted={!props.app?.version}
          />
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
    props.onSettingChange(
      "assistant",
      "scopes",
      assistantScopesPayload(assistant, key, value),
    );
  };

  return (
    <>
      <SettingsSectionBlock title="Mika">
        <SettingsRow
          label="Enable Mika"
          description="Show Mika and allow the assistant to help with files and folders."
          last
        >
          <SwitchControl
            checked={assistant.enabled}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("assistant", "enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Permissions">
        <SettingsRow
          label="Files"
          description="Allow Mika to inspect and organize files in the active workspace."
        >
          <SwitchControl
            checked={assistant.scopes.filesAllowed}
            disabled={props.working || !assistant.enabled}
            onChange={(value) => updateScope("files_allowed", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Cleanup"
          description="Allow Mika to identify clutter and propose cleanup actions."
        >
          <SwitchControl
            checked={assistant.scopes.cleanupAllowed}
            disabled={props.working || !assistant.enabled}
            onChange={(value) => updateScope("cleanup_allowed", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Search"
          description="Allow Mika to search indexed files and folders."
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
  const customFonts = selectCustomFontPreferences(props.document);
  const updateCustomFonts = (fonts: CustomFontPreference[]) => {
    props.onSettingChange(
      "appearance",
      "custom_fonts",
      fonts.map((font) => ({ label: font.label, path: font.path })),
    );
  };
  const addCustomFont = async () => {
    if (!hasTauriInternals()) return;
    const selection = await open({
      title: "Select Font",
      multiple: false,
      directory: false,
      filters: [{ name: "Fonts", extensions: ["ttf", "otf"] }],
    });
    const path = Array.isArray(selection) ? selection[0] : selection;
    if (!path) return;
    const existing = new Set(customFonts.map((font) => font.path));
    if (existing.has(path)) return;
    updateCustomFonts([
      ...customFonts,
      { label: fontLabelFromPath(path), path },
    ]);
  };
  const removeCustomFont = (index: number) => {
    updateCustomFonts(
      customFonts.filter((_, fontIndex) => fontIndex !== index),
    );
  };

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
            value={numberSetting(
              props.document,
              "appearance",
              "ui_scale_index",
              1,
            )}
            options={scaleOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("appearance", "ui_scale_index", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Layout">
        <SettingsRow
          label="Compact mode"
          description="Reduce padding and spacing in file-heavy views."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "appearance",
              "compact_mode_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("appearance", "compact_mode_enabled", value)
            }
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
                  stringSetting(
                    props.document,
                    "appearance",
                    "home_wallpaper_path",
                    "",
                  ),
                )}
                disabled={props.working}
                onChange={(value) =>
                  props.onSettingChange("appearance", "wallpaper_path", value)
                }
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
                  numberSetting(
                    props.document,
                    "appearance",
                    "home_panel_opacity",
                    0.82,
                  ),
                )}
                disabled={props.working}
                onCommit={(value) =>
                  props.onSettingChange("appearance", "panel_opacity", value)
                }
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
            value={numberSetting(
              props.document,
              "appearance",
              "font_size_index",
              1,
            )}
            options={scaleOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("appearance", "font_size_index", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Fonts">
        <SettingsNote>
          Add custom fallback fonts to support filenames and text in additional
          languages.
        </SettingsNote>
        <div className={settingsReferenceListClass}>
          <div
            className={`${settingsFontRowClass} ${settingsReferenceHeaderClass}`}
          >
            <span>Label</span>
            <span>Path</span>
            <span />
          </div>
          {customFonts.map((font, index) => (
            <div className={settingsFontRowClass} key={`${font.path}:${index}`}>
              <span className={settingsReferenceSpanClass}>
                {font.label || fontLabelFromPath(font.path)}
              </span>
              <span
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                title={font.path}
              >
                {font.path}
              </span>
              <button
                type="button"
                className={settingsIconDangerClass}
                aria-label={`Remove ${font.label || font.path}`}
                disabled={props.working}
                onClick={() => removeCustomFont(index)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {customFonts.length === 0 ? (
            <p className={settingsEmptyClass}>No custom fonts added yet.</p>
          ) : null}
        </div>
        <div className={settingsInlineActionsClass}>
          <button
            type="button"
            className={settingsControlButtonCompactClass}
            disabled={props.working}
            onClick={() => void addCustomFont()}
          >
            Add Font
          </button>
        </div>
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
              props.onSettingChange(
                "appearance",
                "thumbnail_previews_enabled",
                value,
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Reduced motion"
          description="Tone down motion and animated transitions."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "appearance",
              "reduced_motion_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "appearance",
                "reduced_motion_enabled",
                value,
              )
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
            checked={booleanSetting(props.document, "privacy", "anonymous_usage_analytics_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("privacy", "anonymous_usage_analytics_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Send anonymous crash reports"
          description="Share sanitized unexpected React and Rust errors without file or account data."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "privacy", "anonymous_error_reporting_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("privacy", "anonymous_error_reporting_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Process data locally"
          description="Keep file handling and provider orchestration local whenever possible."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "privacy",
              "local_processing_only",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("privacy", "local_processing_only", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Share diagnostics"
          description="Allow Misty to include low-level runtime details when exporting diagnostics."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "privacy",
              "diagnostics_sharing_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "privacy",
                "diagnostics_sharing_enabled",
                value,
              )
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Exports & deletion">
        <SettingsRow
          label="Allow data export"
          description="Keep account export actions available in privacy and support workflows."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "privacy",
              "export_data_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("privacy", "export_data_enabled", value)
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

function SyncSettings(props: SettingsContentProps) {
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
      transferProfiles.map((profile) =>
        profile.id === id ? { ...profile, ...patch } : profile,
      ),
    );
  };
  const addProfile = () => {
    const id = `profile-${Date.now().toString(36)}`;
    const base =
      transferProfiles.find((profile) => profile.id === defaultProfileId) ??
      transferProfiles[0];
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
      props.onSettingChange(
        "transfer_profiles",
        "default_profile_id",
        next[0]?.id ?? "balanced",
      );
    }
  };
  return (
    <>
      <SettingsSectionBlock title="Status">
        <SettingsRow
          label="Auto-sync"
          description="Keep Misty in sync without requiring manual refreshes."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "sync",
              "auto_sync_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("sync", "auto_sync_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Version history"
          description="Keep enough state around to recover from accidental overwrites."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "sync",
              "version_history_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("sync", "version_history_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Rules">
        <SettingsRow
          label="Sync on launch"
          description="Check for sync activity automatically when Misty starts."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "sync",
              "sync_on_launch_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("sync", "sync_on_launch_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Sync on quit"
          description="Attempt a final sync pass before Misty closes."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "sync",
              "sync_on_quit_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("sync", "sync_on_quit_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Allow metered sync"
          description="Continue syncing when the network may have bandwidth limits."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "sync",
              "allow_metered_sync",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("sync", "allow_metered_sync", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Conflict resolution">
        <SettingsRow
          label="Default strategy"
          description="Choose how Misty should behave when the same file changes in two places."
          last
        >
          <SelectControl
            value={numberSetting(
              props.document,
              "sync",
              "conflict_resolution_index",
              0,
            )}
            options={conflictOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("sync", "conflict_resolution_index", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

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
          <div
            className={`${settingsReferenceRowClass} ${settingsReferenceHeaderClass}`}
          >
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
              <span className="grid justify-items-end gap-2 text-right text-[#a1a1aa]">
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
                      onCommit={(value) =>
                        updateProfile(profile.id, { transfers: value })
                      }
                    />
                    <ProfileNumberInput
                      label="Checkers"
                      value={profile.checkers}
                      disabled={props.working}
                      onCommit={(value) =>
                        updateProfile(profile.id, { checkers: value })
                      }
                    />
                    <ProfileTextInput
                      label="Limit"
                      value={profile.bandwidthLimit}
                      disabled={props.working}
                      onCommit={(value) =>
                        updateProfile(profile.id, { bandwidthLimit: value })
                      }
                    />
                    <button
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
                    </button>
                    <button
                      className={settingsIconDangerClass}
                      type="button"
                      disabled={props.working}
                      aria-label={`Remove ${profile.name}`}
                      onClick={() => removeProfile(profile.id)}
                    >
                      <Trash2 size={15} strokeWidth={1.8} />
                    </button>
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
        <div className={settingsInlineActionsClass}>
          <button
            className={settingsPrimaryButtonClass}
            type="button"
            disabled={props.working}
            onClick={addProfile}
          >
            Add Profile
          </button>
        </div>
      </SettingsSectionBlock>
    </>
  );
}

function TransfersSettings(props: SettingsContentProps) {
  return (
    <SettingsSectionBlock title="Defaults">
      <SettingsRow
        label="Default transfer behavior"
        description="Choose how copy and download flows should behave by default."
        last
      >
        <SelectControl
          value={numberSetting(
            props.document,
            "general",
            "default_transfer_behavior_index",
            0,
          )}
          options={transferBehaviorOptions}
          disabled={props.working}
          onChange={(value) =>
            props.onSettingChange(
              "general",
              "default_transfer_behavior_index",
              value,
            )
          }
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}

function SearchSettings(_props: SettingsContentProps) {
  const { status, error, initialize, refreshStatus, startScan, cancelScan } =
    useSearchStore(
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
  const indexedLocalItems = status?.indexedLocalItemCount ?? 0;
  const indexedRemoteItems = status?.indexedRemoteItemCount ?? 0;
  const indexedLocalRoots = status?.indexedLocalRoots ?? [];
  const indexedRemoteNames = status?.indexedRemoteNames ?? [];
  const scanProgress = status?.scanIndexedItemCount ?? 0;
  const lastIndexed = status?.lastScanTimeMs
    ? formatDate(status.lastScanTimeMs)
    : "Never";
  const phase = status?.scanPhase
    ? status.scanPhase.replace(/_/g, " ")
    : "idle";
  const outcome = searchOutcomeLabel(status?.lastScanOutcome);
  const indexHasErrors = Boolean(
    error || status?.lastScanError || status?.scanErrors.length,
  );

  return (
    <>
      <SettingsSectionBlock title="Indexing">
        <SettingsNote>
          Misty searches file and folder names from a local metadata index.
          Remote scans refresh provider listings through the existing Misty
          remote runtime.
        </SettingsNote>
        <div className="mt-3 grid grid-cols-4 gap-3">
          <SearchStatCard
            label="Indexed items"
            value={indexedItems.toLocaleString()}
          />
          <SearchStatCard
            label="Local items"
            value={indexedLocalItems.toLocaleString()}
          />
          <SearchStatCard
            label="Remote items"
            value={indexedRemoteItems.toLocaleString()}
          />
          <SearchStatCard
            label="Index size"
            value={formatBytes(status?.indexSizeBytes ?? 0)}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <SearchStatCard
            label="Local roots"
            value={indexedLocalRoots.length.toLocaleString()}
            compact
          />
          <SearchStatCard
            label="Remotes"
            value={indexedRemoteNames.length.toLocaleString()}
            compact
          />
        </div>
        <div className="mt-3 grid min-h-[46px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-y border-white/[0.08] py-3">
          <div className="grid min-w-0 gap-1">
            <strong className="text-[15px] font-[620] text-[#f4f4f5]">
              Search index
            </strong>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-[#a1a1aa]">
              {scanActive
                ? `${phase} · ${scanProgress.toLocaleString()} items scanned${status?.currentPath ? ` · ${status.currentPath}` : ""}`
                : `${outcome} · Last indexed ${lastIndexed}`}
            </span>
            {error || status?.lastScanError ? (
              <span className="text-sm text-[#d6a0a0]">
                {userFacingErrorText(error || status?.lastScanError)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {scanActive ? (
              <button
                type="button"
                className={settingsControlButtonCompactClass}
                onClick={() => void cancelScan()}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className={settingsPrimaryButtonClass}
                onClick={() => void startScan("")}
              >
                {indexHasErrors ? "Reindex Now" : "Reindex All"}
              </button>
            )}
            <button
              type="button"
              className={settingsControlButtonCompactClass}
              onClick={() => void refreshStatus()}
            >
              Refresh
            </button>
          </div>
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Indexed sources">
        <SettingsRow
          label="Local roots"
          description="Local drives or folders included in the most recent completed index."
        >
          <ValueText
            value={
              indexedLocalRoots.length
                ? indexedLocalRoots.join(", ")
                : "None indexed"
            }
            muted={!indexedLocalRoots.length}
          />
        </SettingsRow>
        <SettingsRow
          label="Remotes"
          description="Connected remotes included in the most recent completed index."
        >
          <ValueText
            value={
              indexedRemoteNames.length
                ? indexedRemoteNames.join(", ")
                : "None indexed"
            }
            muted={!indexedRemoteNames.length}
          />
        </SettingsRow>
        <SettingsRow
          label="Last outcome"
          description="Result of the most recent indexing run."
          last
        >
          <ValueText value={outcome} muted={!status?.lastScanOutcome} />
        </SettingsRow>
      </SettingsSectionBlock>

      {status?.scanErrors.length ? (
        <SettingsSectionBlock title="Indexing errors">
          <div className={settingsReferenceListClass}>
            <div
              className={`${settingsReferenceRowClass} ${settingsReferenceHeaderClass}`}
            >
              <span>Source</span>
              <span>Error</span>
            </div>
            {status.scanErrors.map((scanError) => (
              <div
                className={settingsReferenceRowClass}
                key={`${scanError.source}:${scanError.message}`}
              >
                <span className={settingsReferenceSpanClass}>
                  {scanError.source}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere] text-[#d6a0a0]">
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

function SearchStatCard(props: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`${props.compact ? "min-h-[54px]" : "min-h-[76px]"} grid content-center gap-1 rounded-md border border-white/10 bg-[#07090b] px-3`}
    >
      <strong
        className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${props.compact ? "text-[17px]" : "text-[21px]"} font-[720] text-[#f4f4f5]`}
      >
        {props.value}
      </strong>
      <span className="text-xs text-[#8f8f8f]">{props.label}</span>
    </div>
  );
}

function searchOutcomeLabel(outcome: string | null | undefined): string {
  if (outcome === "completed") return "Last scan completed";
  if (outcome === "canceled") return "Last scan canceled";
  if (outcome === "failed") return "Last scan failed";
  return "Not run";
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
              props.onSettingChange(
                "notifications",
                "desktop_notifications_enabled",
                value,
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label="In-app toasts"
          description="Show transient notifications inside Misty."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "notifications",
              "in_app_notifications_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "notifications",
                "in_app_notifications_enabled",
                value,
              )
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
              props.onSettingChange(
                "notifications",
                "sound_notifications_enabled",
                value,
              )
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
            checked={booleanSetting(
              props.document,
              "notifications",
              "badge_count_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "notifications",
                "badge_count_enabled",
                value,
              )
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
            checked={booleanSetting(
              props.document,
              "notifications",
              "quiet_hours_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "notifications",
                "quiet_hours_enabled",
                value,
              )
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
              props.onSettingChange(
                "notifications",
                "digest_notifications_enabled",
                value,
              )
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
            checked={booleanSetting(
              props.document,
              "shortcuts",
              "shortcut_hints_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "shortcuts",
                "shortcut_hints_enabled",
                value,
              )
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
            value={numberSetting(
              props.document,
              "shortcuts",
              "keymap_index",
              0,
            )}
            options={keymapOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("shortcuts", "keymap_index", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Enable custom shortcuts"
          description="Use saved per-command shortcut overrides instead of only Misty's built-in defaults."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "shortcuts",
              "custom_shortcuts_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "shortcuts",
                "custom_shortcuts_enabled",
                value,
              )
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Reference">
        <SettingsNote>
          Review the active bindings Misty has loaded so shortcut behavior is
          easy to test.
        </SettingsNote>
        <div className={settingsReferenceListClass}>
          <div
            className={`${settingsReferenceRowClass} ${settingsReferenceHeaderClass}`}
          >
            <span>Command</span>
            <span>Shortcut</span>
          </div>
          {props.shortcuts.map((binding) => (
            <div className={settingsReferenceRowClass} key={binding.commandId}>
              <span className={settingsReferenceSpanClass}>
                {binding.commandId}
              </span>
              <input
                className={settingsReferenceInputClass}
                value={binding.shortcut}
                disabled={props.working}
                onChange={(event) =>
                  props.onShortcutChange(binding.commandId, event.target.value)
                }
              />
            </div>
          ))}
        </div>
        <div className={settingsInlineActionsClass}>
          <button
            type="button"
            className={settingsPrimaryButtonClass}
            disabled={props.working}
            onClick={() => void props.onSaveShortcuts()}
          >
            Save Changes
          </button>
          <button
            type="button"
            className={settingsControlButtonCompactClass}
            disabled={props.working}
            onClick={() => void props.onLoad()}
          >
            Reset
          </button>
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
          label="Debug logging"
          description="Keep more verbose runtime details available while polishing the release."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "advanced",
              "debug_logging_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("advanced", "debug_logging_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Experimental features"
          description="Allow in-progress features to surface before they are fully settled."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "advanced",
              "experimental_features_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "advanced",
                "experimental_features_enabled",
                value,
              )
            }
          />
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
              props.onSettingChange(
                "advanced",
                "frame_pacing_overlay_enabled",
                value,
              )
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
            value={stringSetting(
              props.document,
              "advanced",
              "extension_tools_path",
              "",
            )}
            placeholder="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
            disabled={props.working}
            onCommit={(value) =>
              props.onSettingChange("advanced", "extension_tools_path", value)
            }
            wide
          />
        </SettingsRow>
        <SettingsRow
          label="Server address"
          description="The gRPC address Misty uses for local file operations."
        >
          <TextControl
            value={stringSetting(
              props.document,
              "advanced",
              "server_address",
              "localhost:50051",
            )}
            disabled={props.working}
            onCommit={(value) =>
              props.onSettingChange("advanced", "server_address", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Mount path"
          description="The root path Misty should treat as its default mount target."
          last
        >
          <TextControl
            value={stringSetting(
              props.document,
              "advanced",
              "mount_path",
              ".misty/mnt",
            )}
            disabled={props.working}
            onCommit={(value) =>
              props.onSettingChange("advanced", "mount_path", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Open with associations">
        <SettingsNote>
          Review remembered apps used by File Explorer.
        </SettingsNote>
        <div className={settingsReferenceListClass}>
          <div
            className={`${settingsAssociationRowClass} ${settingsReferenceHeaderClass}`}
          >
            <span>File</span>
            <span>Application</span>
            <span />
          </div>
          {props.openWithAssociations.map((association) => (
            <div className={settingsAssociationRowClass} key={association.key}>
              <span className={settingsReferenceSpanClass}>
                {association.key}
              </span>
              <span
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                title={association.applicationPath}
              >
                {association.applicationPath}
              </span>
              <button
                type="button"
                className={settingsIconDangerClass}
                aria-label={`Remove ${association.key}`}
                disabled={props.working}
                onClick={() =>
                  void props.onRemoveOpenWithAssociation(association.key)
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {props.openWithAssociations.length === 0 ? (
            <p className={settingsEmptyClass}>
              No Open With associations saved.
            </p>
          ) : null}
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Safeguards">
        <SettingsRow
          label="Confirm clear recent"
          description="Ask before clearing the recent-items list."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "advanced",
              "confirm_clear_recent",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("advanced", "confirm_clear_recent", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Confirm clear starred"
          description="Ask before clearing starred items in bulk."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "advanced",
              "confirm_clear_starred",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("advanced", "confirm_clear_starred", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Confirm empty trash"
          description="Require confirmation before emptying trash."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "advanced",
              "confirm_empty_trash",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("advanced", "confirm_empty_trash", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Confirm clear cache"
          description="Ask before clearing runtime caches and temporary data."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "advanced",
              "confirm_clear_cache",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("advanced", "confirm_clear_cache", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function SettingsSectionBlock(props: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3.5 overflow-hidden rounded-lg border border-white/10 bg-[var(--misty-app-surface-bg,#090b0d)] shadow-[0_1px_0_rgba(255,255,255,0.035)_inset]">
      <h2 className="border-b border-white/[0.08] bg-[rgba(12,14,16,var(--misty-app-panel-opacity,1))] px-7 py-4 text-[11px] font-[760] leading-none tracking-normal text-[#a1a1aa]">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function SettingsRow(props: {
  label: string;
  description: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`grid min-h-[68px] grid-cols-[minmax(0,0.52fr)_minmax(260px,0.48fr)] items-center gap-[18px] border-b border-white/[0.08] bg-[var(--misty-app-surface-bg,#090b0d)] px-7 py-3 ${props.last ? "border-b-0" : ""}`}
    >
      <div className="grid min-w-0 gap-1">
        <strong className="text-[15px] font-[620] leading-[1.1] text-[#f4f4f5]">
          {props.label}
        </strong>
        <span className="text-[14px] leading-[1.25] text-[#8f8f8f]">
          {props.description}
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-end overflow-hidden">
        {props.children}
      </div>
    </div>
  );
}

function SettingsNote(props: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-[620px] px-7 py-4 text-[14px] leading-[1.35] text-[#8f8f8f]">
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
    <div className="grid min-w-0 justify-items-end gap-2">
      <span
        className={`max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-[15px] ${props.value ? "text-[#f4f4f5]" : "text-[#8f8f8f]"}`}
        title={props.value || "Default"}
      >
        {props.value || "Default"}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={settingsControlButtonCompactClass}
          disabled={props.disabled || !pickerAvailable}
          title={
            pickerAvailable
              ? "Choose workspace root"
              : "Folder picker unavailable on this platform"
          }
          onClick={() => void chooseFolder()}
        >
          Choose
        </button>
        <button
          type="button"
          className={settingsControlButtonCompactClass}
          disabled={props.disabled || !props.value}
          onClick={() => props.onChange("")}
        >
          Reset
        </button>
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
    <div className="grid w-full min-w-0 justify-items-end gap-2">
      <span
        className={`block w-full min-w-0 max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-[15px] ${props.value ? "text-[#f4f4f5]" : "text-[#8f8f8f]"}`}
        title={props.value || "None"}
      >
        {props.value || "None"}
      </span>
      <div className="grid w-full max-w-[360px] grid-cols-2 gap-2">
        <button
          type="button"
          className={`${settingsControlButtonClass} w-full`}
          disabled={props.disabled || !pickerAvailable}
          title={
            pickerAvailable
              ? "Choose app wallpaper"
              : "File picker unavailable on this platform"
          }
          onClick={() => void chooseWallpaper()}
        >
          <Image size={15} />
          Choose
        </button>
        <button
          type="button"
          className={`${settingsControlButtonClass} w-full`}
          disabled={props.disabled || !props.value}
          onClick={() => props.onChange("")}
        >
          Reset
        </button>
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
  const [draft, setDraft] = useState(normalizedValue);
  const draftPercent = Math.round(draft * 100);
  const thumbLeft = `calc(${draftPercent}% - ${(draftPercent / 100) * 22}px)`;

  useEffect(() => {
    setDraft(normalizedValue);
  }, [normalizedValue]);

  const commitDraft = () => {
    const nextValue = clampOpacity(draft);
    if (nextValue !== normalizedValue) props.onCommit(nextValue);
  };
  const setDraftFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (props.disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const next = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    setDraft(clampOpacity(next));
  };
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftFromPointer(event);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (props.disabled) return;
    const step = event.shiftKey ? 0.1 : 0.01;
    let nextValue: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown")
      nextValue = draft - step;
    if (event.key === "ArrowRight" || event.key === "ArrowUp")
      nextValue = draft + step;
    if (event.key === "Home") nextValue = 0;
    if (event.key === "End") nextValue = 1;
    if (nextValue === null) return;
    event.preventDefault();
    setDraft(clampOpacity(nextValue));
  };

  return (
    <div className="grid w-full min-w-0 max-w-[360px] justify-items-end gap-2">
      <span className="text-[15px] font-semibold text-[#f4f4f5]">
        {draftPercent}%
      </span>
      <button
        type="button"
        className="settings-opacity-range-wrap"
        disabled={props.disabled}
        role="slider"
        aria-label="Panel opacity"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={draftPercent}
        onBlur={commitDraft}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (
            event.key.startsWith("Arrow") ||
            event.key === "Home" ||
            event.key === "End"
          ) {
            commitDraft();
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            setDraftFromPointer(event);
          }
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          commitDraft();
        }}
      >
        <div className="settings-opacity-range-track" aria-hidden="true">
          <span
            className="settings-opacity-range-thumb"
            style={{ left: thumbLeft }}
          />
        </div>
      </button>
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
    <label className="relative block h-9 w-[220px] overflow-hidden rounded-md border border-white/10 bg-[#050607] text-[#f4f4f5] transition focus-within:border-white/30">
      <select
        className="h-full w-full appearance-none border-0 bg-transparent py-0 pl-2.5 pr-[38px] text-[15px] font-semibold text-inherit outline-none"
        value={Math.min(props.value, props.options.length - 1)}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.target.value))}
      >
        {props.options.map((option, index) => (
          <option key={option} value={index}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-2 text-[#f4f4f5]"
        size={18}
      />
    </label>
  );
}

function SwitchControl(props: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className={`relative h-[24px] w-[44px] rounded-full border p-0 transition-colors duration-150 disabled:opacity-50 ${
        props.checked
          ? "border-[#f4f4f5] bg-[#f4f4f5]"
          : "border-white/15 bg-white/[0.055]"
      }`}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span
        className={`absolute left-[2px] top-1/2 size-[18px] -translate-y-1/2 rounded-full transition-transform duration-150 ${
          props.checked
            ? "translate-x-[20px] bg-[#07090b] shadow-[0_1px_4px_rgba(0,0,0,0.42)]"
            : "translate-x-0 bg-[#d4d4d8] shadow-[0_1px_4px_rgba(0,0,0,0.32)]"
        }`}
      />
    </button>
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
    <input
      key={props.value}
      className={`h-9 rounded-md border border-white/10 bg-[#050607] px-2.5 text-sm text-[#f4f4f5] outline-none transition focus:border-white/30 disabled:opacity-55 ${props.wide ? "w-[min(520px,52vw)]" : "w-[220px]"}`}
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
    const next = Math.max(
      1,
      Math.round(Number(event.currentTarget.value) || props.value),
    );
    if (next !== props.value) props.onCommit(next);
  };
  return (
    <label className="grid gap-1 text-left text-[11px] text-[#a1a1aa]">
      {props.label}
      <input
        key={props.value}
        className="h-8 w-[76px] rounded-md border border-white/10 bg-[#050607] px-2 text-sm text-[#f4f4f5] outline-none transition focus:border-white/30 disabled:opacity-55"
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
    if (event.currentTarget.value !== props.value)
      props.onCommit(event.currentTarget.value.trim());
  };
  return (
    <label className="grid gap-1 text-left text-[11px] text-[#a1a1aa]">
      {props.label}
      <input
        key={props.value}
        className="h-8 w-[92px] rounded-md border border-white/10 bg-[#050607] px-2 text-sm text-[#f4f4f5] outline-none transition focus:border-white/30 disabled:opacity-55"
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
      className={`max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-[15px] ${props.muted ? "text-[#8f8f8f]" : "text-[#f4f4f5]"}`}
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
    <span className="flex min-w-0 max-w-[420px] items-center justify-end gap-2">
      <span
        className={`min-w-0 select-text overflow-hidden text-ellipsis whitespace-nowrap text-right text-[15px] ${props.disabled ? "text-[#8f8f8f]" : "text-[#f4f4f5]"}`}
        title={props.value}
      >
        {props.value}
      </span>
      <button
        type="button"
        className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.045] text-[#f4f4f5] transition hover:border-white/20 hover:bg-white/[0.09] disabled:opacity-55"
        disabled={props.disabled}
        aria-label="Copy value"
        title="Copy"
        onClick={copyValue}
      >
        <Copy size={14} />
      </button>
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
